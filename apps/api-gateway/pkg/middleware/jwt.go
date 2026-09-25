package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// claimsContextKey is the key used to store validated JWT claims in the request context.
type claimsContextKey struct{}

// ClaimsFromContext extracts validated JWT claims from a request context.
func ClaimsFromContext(ctx context.Context) (jwt.MapClaims, bool) {
	claims, ok := ctx.Value(claimsContextKey{}).(jwt.MapClaims)
	return claims, ok
}

// JWTMiddlewareConfig holds JWKS and claim validation settings.
type JWTMiddlewareConfig struct {
	JWKS     keyfunc.Keyfunc
	Issuer   string // Expected "iss" claim (empty = skip validation)
	Audience string // Expected "aud" claim (empty = skip validation)
}

// NewJWTMiddleware creates an HTTP middleware that validates Bearer JWT tokens.
// On success, it stores the parsed claims in the request context.
// On failure, it responds with 401 Unauthorized.
func NewJWTMiddleware(cfg JWTMiddlewareConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, `{"error":"invalid Authorization header format, expected Bearer <token>"}`, http.StatusUnauthorized)
				return
			}

			tokenStr := parts[1]

			// Build parser options based on config
			parserOpts := []jwt.ParserOption{
				jwt.WithValidMethods([]string{"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"}),
			}

			if cfg.Issuer != "" {
				parserOpts = append(parserOpts, jwt.WithIssuer(cfg.Issuer))
			}
			if cfg.Audience != "" {
				parserOpts = append(parserOpts, jwt.WithAudience(cfg.Audience))
			}

			token, err := jwt.Parse(tokenStr, cfg.JWKS.KeyfuncCtx(r.Context()), parserOpts...)
			if err != nil {
				slog.Debug("JWT validation failed",
					"error", err,
					"remote_addr", r.RemoteAddr,
					"path", r.URL.Path,
				)
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			if !token.Valid {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				http.Error(w, `{"error":"unable to extract claims"}`, http.StatusUnauthorized)
				return
			}

			// Store claims in context for downstream handlers
			ctx := context.WithValue(r.Context(), claimsContextKey{}, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
