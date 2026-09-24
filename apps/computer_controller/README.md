# Computer Controller (`apps/computer_controller/`)

The **Computer Controller** is a Golang-based daemon service that provides remote OS execution primitives for AI Agents in sandboxed environments.

It exposes ConnectRPC services over HTTP/1.1 and unencrypted HTTP/2 (h2c) on port `8080` for managing containerized or host execution sessions, running commands (unary and streaming), reading/writing/listing files, and checking GUI display capabilities.

---

## Configuration (`computer.yaml`)

The Computer Controller server loads its configuration from a YAML file named `computer.yaml` located in the working directory where the server is executed.

---

### Configuration Schema Overview

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | String | Yes | N/A | Provider type. Must be either `local` or `docker`. |
| `server` | Object | No | `{}` | Server network settings (`host`, `port`, `security`). |
| `spec` | Object | No | `{}` | Provider-specific Docker configuration (only valid when `type: docker`). |

#### Server Network Settings (`server`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | String | `"localhost"` | Listening host IP or hostname (e.g. `"localhost"`, `"0.0.0.0"`). |
| `port` | Integer | `8080` | Listening port number (1-65535). |
| `security` | Object | Optional | Security settings (`bearerToken`, `apiKey`, and `tls`). |

#### Security Settings (`server.security`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `bearerToken` / `apiKey` | String | `""` | Bearer token for client authentication. Supports environment variable expansion (e.g., `"${CC_API_KEY}"`). |
| `tls` | Object | Optional | TLS server configuration (`tlsCertificate`, `tlsCertificateKey`, `tlsTrustedCertificates`). |

##### TLS Settings (`server.security.tls`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `tlsCertificate` | String | `""` | Path to TLS certificate PEM file. Requires `tlsCertificateKey`. |
| `tlsCertificateKey` | String | `""` | Path to TLS certificate private key PEM file. |
| `tlsTrustedCertificates` | String | `""` | Path to CA bundle file for mTLS client verification. Enables mTLS when specified. |

#### Docker Provider Spec Fields (`spec`)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | String | `""` (Docker default) | Docker daemon socket address (e.g. `"unix:///var/run/docker.sock"` or `"tcp://127.0.0.1:2375"`). |
| `apiVersion` | String | `""` | Docker API version string (e.g. `"1.41"`). |
| `certPath` | String | `""` | Directory path containing TLS certs (`ca.pem`, `cert.pem`, `key.pem`). |
| `imagePullPolicy` | String | `"IfNotPresent"` | Container image pull policy (`IfNotPresent`, `Always`, or `Never`). |

---

### Configuration Examples & Snippets

#### 1. Minimal Local Host Mode

Executes commands directly on the host machine listening on `localhost:8080`:

```yaml
type: local
server:
  host: "localhost"
  port: 8080
```

#### 2. Local Mode with Bearer Token Authentication

Enforces bearer token authentication for all ConnectRPC client requests:

```yaml
type: local
server:
  host: "0.0.0.0"
  port: 8080
  security:
    bearerToken: "${CC_API_KEY:-'my-secret-token'}"
```

#### 3. Local Mode with HTTPS (TLS Encryption)

Encrypts server traffic using TLS server certificates:

```yaml
type: local
server:
  host: "0.0.0.0"
  port: 8443
  security:
    tls:
      tlsCertificate: "/etc/ssl/certs/server.crt"
      tlsCertificateKey: "/etc/ssl/certs/server.key"
```

#### 4. Local Mode with Mutual TLS (mTLS) Client Verification

Requires clients to present a valid TLS certificate signed by the trusted CA bundle:

```yaml
type: local
server:
  host: "0.0.0.0"
  port: 8443
  security:
    tls:
      tlsCertificate: "/etc/ssl/certs/server.crt"
      tlsCertificateKey: "/etc/ssl/certs/server.key"
      tlsTrustedCertificates: "/etc/ssl/certs/ca-bundle.crt"
```

#### 5. Docker Mode (Standard Unix Socket)

Spawns sandboxed Docker containers via local Docker daemon Unix socket:

```yaml
type: docker
server:
  host: "0.0.0.0"
  port: 8080
spec:
  host: "unix:///var/run/docker.sock"
  imagePullPolicy: "IfNotPresent"
```

#### 6. Docker Mode (Remote Docker Daemon over TCP with TLS Certs)

Connects to a remote Docker engine host using TLS client certificates:

```yaml
type: docker
server:
  host: "0.0.0.0"
  port: 8080
  security:
    bearerToken: "${CC_API_KEY}"
spec:
  host: "tcp://192.168.1.100:2376"
  apiVersion: "1.41"
  certPath: "/etc/docker/client-certs" # Contains ca.pem, cert.pem, key.pem
  imagePullPolicy: "Always"
```

---

### Network Access Control & Egress Firewalling (Docker Mode)

When `CreateComputer` is invoked by an agent harness with `networkRules` (`allowedHosts` and/or `deniedHosts`), the Computer Controller enforces non-root container network sandboxing:

1. **Internal Bridge Network (`Internal: true`)**:
   - Each session with network rules creates an isolated internal Docker bridge network (`byoai-net-<session_id>`) with **no default internet gateway**.
   - Direct IP connection attempts (`curl http://1.1.1.1` or raw TCP sockets) fail instantly with `Network is unreachable`.
2. **Embedded User-Space Egress Proxy (HTTP, HTTPS & SOCKS5)**:
   - An in-process Go HTTP/CONNECT and RFC 1928 SOCKS5 proxy server (`EgressProxy`) runs on the host bound to the bridge network interface.
   - Container environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `all_proxy`) route web and raw TCP traffic (PostgreSQL, DB2, SSH, Redis) through `host.docker.internal:<proxy_port>`.
   - Host rules support exact hostnames (`api.openai.com`), domain wildcards (`*.github.com`), individual IPs (`1.1.1.1`), and CIDR subnets (`10.0.0.0/8`). `deniedHosts` takes priority over `allowedHosts`.

#### Agent Harness Network Rules Snippet (`agent.yaml`)

```yaml
toolProviders:
  - type: computer
    provider:
      type: remote
      url: "http://localhost:8080"
      image: "alpine:latest"
      security:
        bearerToken: "apiKey"
      networkRules:
        allowedHosts:
          - "*.github.com"
          - "api.openai.com"
        deniedHosts:
          - "10.0.0.0/8"
```

---

### Example Configuration Files in Repository

- **[Docker Mode Example (`computer.yaml`)](file:///home/aditya/projects/BYoAI-Deployment-Platform/examples/docker-computer-use/computer.yaml)**: Complete Docker provider configuration with bearer token authentication.

---

## Building

You can build the Computer Controller binary using `task` or Go tools:

### Using `task` (Root or Local)
```bash
# From repository root
task computer_controller:build

# Or from apps/computer_controller directory
cd apps/computer_controller
task build
```

### Using Go CLI
```bash
cd apps/computer_controller
go build -v -o bin/controller ./cmd/controller
```

---

## Running the Server

1. **Prepare `computer.yaml`** in your current working directory (e.g., inside `apps/computer_controller/`):
   ```yaml
   type: local
   ```

2. **Start the Controller Service**:
   - **Using `task`**:
     ```bash
     cd apps/computer_controller
     task run
     ```
   - **Using `go run`**:
     ```bash
     cd apps/computer_controller
     go run ./cmd/controller
     ```
   - **Using compiled binary**:
     ```bash
     cd apps/computer_controller
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

# Or inside apps/computer_controller
cd apps/computer_controller
task test
# equivalent to: go test -v ./...
```

### Docker Integration Tests
Runs tests that interact with an active Docker daemon (requires a running Docker daemon):
```bash
cd apps/computer_controller
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
cd apps/computer_controller
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

