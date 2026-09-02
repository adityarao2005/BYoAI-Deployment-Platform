# Computer Controller (`computer_controller/`)

The **Computer Controller** is a Golang-based daemon service that provides remote OS execution primitives for AI Agents in sandboxed environments.

It exposes ConnectRPC services over HTTP/1.1 and unencrypted HTTP/2 (h2c) on port `8080` for managing containerized or host execution sessions, running commands (unary and streaming), reading/writing/listing files, and checking GUI display capabilities.

---

## Configuration (`computer.yaml`)

The Computer Controller server loads its configuration from a YAML file named `computer.yaml` located in the working directory where the server is executed.

### Configuration Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | String | Yes | Provider type. Must be either `local` or `docker`. |
| `server` | Object | No | Server network settings (`host` and `port`). |
| `spec` | Object | No | Provider-specific configuration. Only allowed when `type` is `docker`. |

#### Server Network Settings (`server`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | String | `"localhost"` | Listening host IP or hostname (e.g. `"localhost"`, `"0.0.0.0"`). |
| `port` | Integer | `8080` | Listening port number (1-65535). |
| `security` | Object | Optional | Security settings (`apiKey` and `tls`). |

#### Security Settings (`server.security`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | String | `""` | Bearer token for authentication. Supports environment variable expansion (e.g., `"${CC_API_KEY}"`). |
| `tls` | Object | Optional | TLS server configuration (`tlsCertificate`, `tlsCertificateKey`, `tlsTrustedCertificates`). |

##### TLS Settings (`server.security.tls`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `tlsCertificate` | String | `""` | Path to TLS certificate PEM file. Requires `tlsCertificateKey`. |
| `tlsCertificateKey` | String | `""` | Path to TLS certificate private key PEM file. |
| `tlsTrustedCertificates` | String | `""` | Path to CA bundle file for mTLS client verification. Enables mTLS when specified. |

---

### 1. Local Mode (`type: local`)

Executes commands and file operations directly on the host operating system. When `type` is set to `local`, the `spec` field **must be omitted**.

#### Example `computer.yaml`
```yaml
type: local
server:
  host: "localhost"
  port: 8080
  security:
    apiKey: "${CC_API_KEY}"
    tls:
      tlsCertificate: "/path/to/server.crt"
      tlsCertificateKey: "/path/to/server.key"
      tlsTrustedCertificates: "/path/to/ca.crt"
```

---

### 2. Docker Mode (`type: docker`)

Manages sandboxed Docker containers for execution. Supports custom daemon sockets, TLS authentication, image pull policies, and container idle reaping.

#### Docker Spec Fields (`spec`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | String | `""` (Docker default) | Docker daemon socket address (e.g. `"unix:///var/run/docker.sock"` or `"tcp://127.0.0.1:2375"`). |
| `apiVersion` | String | `""` | Docker API version string (e.g. `"1.41"`). |
| `certPath` | String | `""` | Directory path containing TLS certs (`ca.pem`, `cert.pem`, `key.pem`). |
| `imagePullPolicy` | String | `"IfNotPresent"` | Container image pull policy. Must be one of `IfNotPresent`, `Always`, or `Never`. |
| `reapIdleContainersAfter` | Duration | `0s` (Disabled) | Inactivity duration before idle containers are reaped (e.g. `"10m"`, `"1h"`). |

#### Example `computer.yaml`
```yaml
type: docker
server:
  host: "0.0.0.0"
  port: 8080
spec:
  host: "unix:///var/run/docker.sock"
  apiVersion: "1.41"
  certPath: "/etc/docker/certs"
  imagePullPolicy: "IfNotPresent"
  reapIdleContainersAfter: "10m"
```

---

## Building

You can build the Computer Controller binary using `task` or Go tools:

### Using `task` (Root or Local)
```bash
# From repository root
task build

# Or from computer_controller directory
cd computer_controller
task build
```

### Using Go CLI
```bash
cd computer_controller
go build -v -o bin/controller ./cmd/controller
```

---

## Running the Server

1. **Prepare `computer.yaml`** in your current working directory (e.g., inside `computer_controller/`):
   ```yaml
   type: local
   ```

2. **Start the Controller Service**:
   - **Using `task`**:
     ```bash
     cd computer_controller
     task run
     ```
   - **Using `go run`**:
     ```bash
     cd computer_controller
     go run ./cmd/controller
     ```
   - **Using compiled binary**:
     ```bash
     cd computer_controller
     ./bin/controller
     ```

Upon startup, the server listens on `localhost:8080`.

---

## Running Tests

### Unit Tests
Runs standard unit tests for config parsing, provider instantiation, and local execution primitives:
```bash
# From repository root
task unit_test

# Or inside computer_controller
cd computer_controller
task test
# equivalent to: go test -v ./...
```

### Docker Integration Tests
Runs tests that interact with an active Docker daemon (requires a running Docker daemon):
```bash
cd computer_controller
task docker_test
# equivalent to: DOCKER_INTEGRATION_TEST=1 go test -v ./...
```

---

## Container Images & Security Sandbox

Multi-stage Docker targets are provided in `docker/Dockerfile` with strict user isolation:

### Target Matrix

| Target Name | Type | Base OS | Exec User | Workspace & Permissions |
| --- | --- | --- | --- | --- |
| `local-scratch` | `local` | `scratch` | `65532:65532` | Minimal static image; `/workspace` workdir; `/app/computer.yaml` read-only. |
| `local-alpine` | `local` | `alpine:latest` | `10001:10001` | Alpine base; `/workspace` workdir (`0755`); `/app/computer.yaml` read-only (`0444`). |
| `local-debian` | `local` | `debian:bookworm-slim` | `10001:10001` | Debian base; `/workspace` workdir (`0755`); `/app/computer.yaml` read-only (`0444`). |
| `local-redhat` | `local` | `ubi9-minimal` | `10001:10001` | RedHat UBI9 minimal; `/workspace` workdir (`0755`); `/app/computer.yaml` read-only (`0444`). |
| `docker-podman-redhat` | `docker` | `quay.io/podman/stable` | `10001:10001` | Podman RedHat image; read-only system/app dirs; connects via `DOCKER_HOST`. |
| `docker-podman-debian` | `docker` | `debian:bookworm-slim` | `10001:10001` | Debian + Podman CLI; read-only system/app dirs; connects via `DOCKER_HOST`. |
| `docker-podman-alpine` | `docker` | `alpine:latest` | `10001:10001` | Alpine + Podman CLI; read-only system/app dirs; connects via `DOCKER_HOST`. |

### Building Container Images

Build all images:
```bash
cd computer_controller
task build_container_images
```

Build a specific target image using `task`:
```bash
task build_container_image TARGET=local-alpine
task build_container_image TARGET=local-debian
task build_container_image TARGET=docker-podman-redhat
```

Or using `docker build`:
```bash
docker build -f docker/Dockerfile --target local-alpine -t computer-controller:local-alpine .
```

