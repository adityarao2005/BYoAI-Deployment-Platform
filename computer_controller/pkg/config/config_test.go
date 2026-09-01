package config

import (
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	t.Run("Valid Local Config", func(t *testing.T) {
		yamlData := []byte(`
type: local
`)
		cfg, err := LoadConfig(yamlData)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if cfg.Type != TypeLocal {
			t.Errorf("expected type %q, got %q", TypeLocal, cfg.Type)
		}
		if cfg.Server.Host != "localhost" {
			t.Errorf("expected default server host %q, got %q", "localhost", cfg.Server.Host)
		}
		if cfg.Server.Port != 8080 {
			t.Errorf("expected default server port 8080, got %d", cfg.Server.Port)
		}
		if cfg.Server.Address() != "localhost:8080" {
			t.Errorf("expected default address %q, got %q", "localhost:8080", cfg.Server.Address())
		}
	})

	t.Run("Valid Local Config with Custom Server Settings", func(t *testing.T) {
		yamlData := []byte(`
type: local
server:
  host: "0.0.0.0"
  port: 9090
`)
		cfg, err := LoadConfig(yamlData)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if cfg.Server.Host != "0.0.0.0" {
			t.Errorf("expected server host %q, got %q", "0.0.0.0", cfg.Server.Host)
		}
		if cfg.Server.Port != 9090 {
			t.Errorf("expected server port 9090, got %d", cfg.Server.Port)
		}
		if cfg.Server.Address() != "0.0.0.0:9090" {
			t.Errorf("expected address %q, got %q", "0.0.0.0:9090", cfg.Server.Address())
		}
	})

	t.Run("Invalid Server Port Config", func(t *testing.T) {
		yamlData := []byte(`
type: local
server:
  port: 70000
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error for invalid server port, got nil")
		}
	})

	t.Run("Invalid Local Config with Spec", func(t *testing.T) {
		yamlData := []byte(`
type: local
spec:
  host: "localhost"
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error when local type provides spec, got nil")
		}
	})

	t.Run("Valid Docker Config with Full Spec", func(t *testing.T) {
		yamlData := []byte(`
type: docker
spec:
  host: "unix:///var/run/docker.sock"
  apiVersion: "1.41"
  certPath: "/etc/docker/certs"
  imagePullPolicy: "Always"
  reapIdleContainersAfter: "10m"
`)
		cfg, err := LoadConfig(yamlData)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if cfg.Type != TypeDocker {
			t.Errorf("expected type %q, got %q", TypeDocker, cfg.Type)
		}

		dockerSpec, ok := cfg.Spec.(DockerSpec)
		if !ok {
			t.Fatalf("expected Spec to be DockerSpec, got %T", cfg.Spec)
		}

		if dockerSpec.Host != "unix:///var/run/docker.sock" {
			t.Errorf("expected Host %q, got %q", "unix:///var/run/docker.sock", dockerSpec.Host)
		}
		if dockerSpec.APIVersion != "1.41" {
			t.Errorf("expected APIVersion %q, got %q", "1.41", dockerSpec.APIVersion)
		}
		if dockerSpec.CertPath != "/etc/docker/certs" {
			t.Errorf("expected CertPath %q, got %q", "/etc/docker/certs", dockerSpec.CertPath)
		}
		if dockerSpec.ImagePullPolicy != Always {
			t.Errorf("expected ImagePullPolicy %q, got %q", Always, dockerSpec.ImagePullPolicy)
		}
		if dockerSpec.ReapIdleContainersAfter != 10*time.Minute {
			t.Errorf("expected ReapIdleContainersAfter %v, got %v", 10*time.Minute, dockerSpec.ReapIdleContainersAfter)
		}
	})

	t.Run("Valid Docker Config with Omitted Spec (Defaults ImagePullPolicy)", func(t *testing.T) {
		yamlData := []byte(`
type: docker
`)
		cfg, err := LoadConfig(yamlData)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if cfg.Type != TypeDocker {
			t.Errorf("expected type %q, got %q", TypeDocker, cfg.Type)
		}
		dockerSpec, ok := cfg.Spec.(DockerSpec)
		if !ok {
			t.Fatalf("expected Spec to be DockerSpec, got %T", cfg.Spec)
		}
		if dockerSpec.ImagePullPolicy != IfNotPresent {
			t.Errorf("expected default ImagePullPolicy %q, got %q", IfNotPresent, dockerSpec.ImagePullPolicy)
		}
	})

	t.Run("Invalid Docker Spec ImagePullPolicy", func(t *testing.T) {
		yamlData := []byte(`
type: docker
spec:
  imagePullPolicy: "InvalidPolicy"
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error for invalid imagePullPolicy, got nil")
		}
	})

	t.Run("Unsupported Config Type", func(t *testing.T) {
		yamlData := []byte(`
type: unsupported_type
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error for unsupported computer type, got nil")
		}
	})

	t.Run("Invalid Docker Spec Duration", func(t *testing.T) {
		yamlData := []byte(`
type: docker
spec:
  reapIdleContainersAfter: invalid_duration
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error for invalid docker spec, got nil")
		}
	})

	t.Run("Invalid YAML Syntax", func(t *testing.T) {
		yamlData := []byte(`
type: local
invalid_yaml: [
`)
		_, err := LoadConfig(yamlData)
		if err == nil {
			t.Fatal("expected error for invalid YAML syntax, got nil")
		}
	})

	t.Run("DockerSpec isSpec method", func(t *testing.T) {
		spec := DockerSpec{}
		spec.isSpec()
	})
}
