package chat_ui

import (
	"embed"
	"io/fs"
)

//go:embed all:frontend/dist
var distEmbedFS embed.FS

// DistFS returns an fs.FS sub-filesystem rooted at frontend/dist.
func DistFS() (fs.FS, error) {
	return fs.Sub(distEmbedFS, "frontend/dist")
}
