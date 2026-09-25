package server

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// SPAHandler serves static files from an fs.FS (e.g. embed.FS) and falls back to index.html for client-side routing.
type SPAHandler struct {
	FileSystem http.FileSystem
	IndexPath  string
}

// NewSPAHandler creates a new SPAHandler given an fs.FS and index path.
func NewSPAHandler(distFS fs.FS, indexPath string) *SPAHandler {
	if indexPath == "" {
		indexPath = "index.html"
	}
	return &SPAHandler{
		FileSystem: http.FS(distFS),
		IndexPath:  indexPath,
	}
}

func (h *SPAHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Clean URL path
	upath := path.Clean(r.URL.Path)
	if !strings.HasPrefix(upath, "/") {
		upath = "/" + upath
	}

	// Try to open the requested file
	f, err := h.FileSystem.Open(strings.TrimPrefix(upath, "/"))
	if err == nil {
		defer f.Close()
		stat, err := f.Stat()
		if err == nil && !stat.IsDir() {
			http.FileServer(h.FileSystem).ServeHTTP(w, r)
			return
		}
	}

	// If file doesn't exist or is a directory, fallback to index.html for SPA routing
	indexFile, err := h.FileSystem.Open(h.IndexPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "Failed to load index.html", http.StatusInternalServerError)
		return
	}
	defer indexFile.Close()

	stat, err := indexFile.Stat()
	if err != nil {
		http.Error(w, "Failed to inspect index.html", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, h.IndexPath, stat.ModTime(), indexFile.(ioReadSeeker))
}

type ioReadSeeker interface {
	fs.File
	Seek(offset int64, whence int) (int64, error)
}
