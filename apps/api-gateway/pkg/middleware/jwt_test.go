package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// testKeyPair creates an RSA key pair for testing.
func testKeyPair(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}
	return key
}

// signToken creates a signed JWT string using the given key and claims.
func signToken(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	tokenStr, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}
	return tokenStr
}

// jwksJSON builds a JWKS JSON response for the given RSA public key.
func jwksJSON(t *testing.T, key *rsa.PublicKey, kid string) []byte {
	t.Helper()
	jwksData := map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"kid": kid,
				"n":   base64URLEncode(key.N.Bytes()),
				"e":   base64URLEncode(big.NewInt(int64(key.E)).Bytes()),
			},
		},
	}

	data, err := json.Marshal(jwksData)
	if err != nil {
		t.Fatalf("failed to marshal JWKS: %v", err)
	}
	return data
}

// base64URLEncode encodes bytes as base64url without padding.
func base64URLEncode(b []byte) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	result := make([]byte, 0, (len(b)*4+2)/3)
	for i := 0; i < len(b); i += 3 {
		val := uint(b[i]) << 16
		if i+1 < len(b) {
			val |= uint(b[i+1]) << 8
		}
		if i+2 < len(b) {
			val |= uint(b[i+2])
		}

		result = append(result, chars[(val>>18)&0x3F])
		result = append(result, chars[(val>>12)&0x3F])
		if i+1 < len(b) {
			result = append(result, chars[(val>>6)&0x3F])
		}
		if i+2 < len(b) {
			result = append(result, chars[val&0x3F])
		}
	}
	return string(result)
}

// setupTestJWKS creates a mock JWKS server and returns the keyfunc and key for signing.
func setupTestJWKS(t *testing.T) (*rsa.PrivateKey, keyfunc.Keyfunc) {
	t.Helper()

	key := testKeyPair(t)
	kid := "test-key-1"

	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(jwksJSON(t, &key.PublicKey, kid))
	}))
	t.Cleanup(jwksServer.Close)

	jwks, err := keyfunc.NewDefault([]string{jwksServer.URL})
	if err != nil {
		t.Fatalf("failed to create keyfunc: %v", err)
	}

	return key, jwks
}

func TestJWTMiddleware_ValidToken(t *testing.T) {
	key, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{
		JWKS:     jwks,
		Issuer:   "https://test-issuer.example.com",
		Audience: "test-api",
	})

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFromContext(r.Context())
		if !ok {
			t.Error("expected claims in context")
		}
		if claims["sub"] != "user-123" {
			t.Errorf("expected sub 'user-123', got '%v'", claims["sub"])
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("authorized"))
	}))

	tokenStr := signToken(t, key, "test-key-1", jwt.MapClaims{
		"sub": "user-123",
		"iss": "https://test-issuer.example.com",
		"aud": "test-api",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestJWTMiddleware_MissingAuthHeader(t *testing.T) {
	_, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{JWKS: jwks})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_InvalidBearerFormat(t *testing.T) {
	_, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{JWKS: jwks})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Basic some-credentials")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_ExpiredToken(t *testing.T) {
	key, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{JWKS: jwks})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for expired token")
	}))

	tokenStr := signToken(t, key, "test-key-1", jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(-time.Hour).Unix(), // expired
		"iat": time.Now().Add(-2 * time.Hour).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_WrongIssuer(t *testing.T) {
	key, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{
		JWKS:   jwks,
		Issuer: "https://expected-issuer.example.com",
	})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for wrong issuer")
	}))

	tokenStr := signToken(t, key, "test-key-1", jwt.MapClaims{
		"sub": "user-123",
		"iss": "https://wrong-issuer.example.com",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_WrongAudience(t *testing.T) {
	key, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{
		JWKS:     jwks,
		Audience: "expected-api",
	})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for wrong audience")
	}))

	tokenStr := signToken(t, key, "test-key-1", jwt.MapClaims{
		"sub": "user-123",
		"aud": "wrong-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_MalformedToken(t *testing.T) {
	_, jwks := setupTestJWKS(t)

	mw := NewJWTMiddleware(JWTMiddlewareConfig{JWKS: jwks})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid.jwt.token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestJWTMiddleware_NoIssuerOrAudienceValidation(t *testing.T) {
	key, jwks := setupTestJWKS(t)

	// When issuer and audience are empty, skip those validations
	mw := NewJWTMiddleware(JWTMiddlewareConfig{JWKS: jwks})
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	tokenStr := signToken(t, key, "test-key-1", jwt.MapClaims{
		"sub": "user-456",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}
