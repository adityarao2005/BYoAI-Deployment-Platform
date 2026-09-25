package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSPAHandler_ServeExistingFile(t *testing.T) {
	mockFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<html><body>Root</body></html>"),
		},
		"assets/app.js": &fstest.MapFile{
			Data: []byte("console.log('hello');"),
		},
	}

	handler := NewSPAHandler(mockFS, "index.html")

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "console.log('hello');" {
		t.Errorf("Unexpected body: %s", string(body))
	}
}

func TestSPAHandler_FallbackToIndex(t *testing.T) {
	mockFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<html><body>Root</body></html>"),
		},
	}

	handler := NewSPAHandler(mockFS, "index.html")

	req := httptest.NewRequest(http.MethodGet, "/interactions/123/chat", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "<html><body>Root</body></html>" {
		t.Errorf("Unexpected body for fallback: %s", string(body))
	}
}
