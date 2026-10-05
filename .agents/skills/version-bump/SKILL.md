---
name: version-bump
description: Workflows and guidelines for platform version bumping pre-merge on feature branches and release execution post-merge on main.
---
# Version Bump & Release Workflow

Use this skill when bumping the platform version for new features, bug fixes, or preparing releases across the BYoAI platform.

---

## Semantic Versioning Guidelines

The platform version follows [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`

- **MAJOR (`X.0.0`)**: Incompatible API breaks, wire protocol changes in ConnectRPC, breaking CLI flags, or major architectural deprecations.
- **MINOR (`0.X.0`)**: Backwards-compatible new features (e.g. adding Kubernetes Computer Provider, new tool providers, subagent capabilities).
- **PATCH (`0.0.X`)**: Backwards-compatible bug fixes, minor performance improvements, internal dependency updates.

---

## Phase 1: Pre-Merge Workflow (On Feature / Bugfix Branch)

When developing a feature or fix on a branch (e.g., `feature/22/add-k8s-for-computer-controller`):

### 1. Update Version Files
Update the version string in the following files:
1. **`VERSION`** (repository root):
   Plain text file containing only the version string and a newline:
   ```text
   0.7.0
   ```
2. **`package.json`** (repository root):
   Update the top-level `"version"` field:
   ```json
   {
       "name": "@byo-ai-agent-platform",
       "version": "0.7.0",
       ...
   }
   ```

### 2. Verify Build Sources & Local Compilation
Ensure that sub-project build tasks detect the updated version (e.g., `apps/computer_controller/Taskfile.yml` includes `../../VERSION` in build sources).

Rebuild the binary to ensure version injection via `-ldflags` succeeds:
```bash
# Verify version output
task version

# Test building Go binary with new version
cd apps/computer_controller
task build
./bin/controller --version
cd ../..
```

### 3. Run Validation Tests
Run the test suite to ensure the version bump and code changes pass all checks:
```bash
# Run unit tests across all monorepo subprojects
task unit_test

# Or run typecheck and linting
bun run check
```

### 4. Commit Changes
Commit the updated version files to the branch:
```bash
git add VERSION package.json apps/computer_controller/Taskfile.yml
git commit -m "chore: bump platform version to X.Y.Z"
```

> [!WARNING]
> ### DO NOT RUN `task release` ON FEATURE BRANCHES
> **Never** run `task release` while on an unmerged branch.
> 
> `task release` creates and **immediately pushes** a `v*` git tag to GitHub (`origin`). Pushing a release tag automatically triggers the production release pipeline (`.github/workflows/release.yml`), which publishes multi-arch Docker images to GHCR and generates a GitHub Release. Running this on an unmerged branch will prematurely publish unreviewed code to production.

---

## Phase 2: Post-Merge Workflow (On `main` Branch)

Once the Pull Request is approved and merged into `main`:

### 1. Check Out and Update `main`
```bash
git checkout main
git pull origin main
```

### 2. Verify Working Tree & Version
Ensure there are no uncommitted changes and the merged `VERSION` matches expectations:
```bash
# Check working tree is clean
git status

# Inspect current version
cat VERSION
task version
```

### 3. Execute Release
Run the release task from the repository root:
```bash
task release
```

This task performs:
1. Verifies `VERSION` file exists.
2. Checks that `git diff --quiet HEAD` passes (working directory is clean).
3. Reads `VERSION` and constructs tag `v${VERSION}` (e.g., `v0.7.0`).
4. Creates an annotated git tag: `git tag -a "v${VERSION}" -m "Release v${VERSION}"`.
5. Pushes the tag to remote: `git push origin "v${VERSION}"`.

### 4. Monitor GitHub Actions Release Pipeline
Once the tag is pushed, track the release workflow in GitHub Actions (`.github/workflows/release.yml`):
- **Validation**: Verifies that the git tag matches the `VERSION` file.
- **Test**: Executes `task unit_test`.
- **Binaries**: Cross-compiles Go binaries for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`, `windows/arm64`.
- **Docker Images**: Builds multi-arch container images and pushes them to GHCR:
  - `ghcr.io/<owner>/byoai-agentic-harness`
  - `ghcr.io/<owner>/byoai-computer-controller`
  - `ghcr.io/<owner>/byoai-computer-controller-podman`
  - `ghcr.io/<owner>/byoai-chat-ui`
  - `ghcr.io/<owner>/byoai-shell-cli`
- **GitHub Release**: Publishes a release draft/release with all binaries attached and auto-generated release notes.

---

## Quick Reference Summary

| Stage | Allowed Actions | Forbidden Actions |
| :--- | :--- | :--- |
| **Pre-Merge** *(Feature Branch)* | • Edit `VERSION`<br>• Edit `package.json`<br>• Run `task version`<br>• Run `task build`<br>• Run `task unit_test`<br>• Commit & push branch | ❌ **DO NOT run `task release`**<br>❌ **DO NOT create or push `v*` tags** |
| **Post-Merge** *(On `main`)* | • Pull latest `main`<br>• Verify clean working tree<br>• Run `task release` | ❌ Do not run with dirty git working tree |
