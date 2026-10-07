# BYoAI Platform Benchmarks

This directory provides automated benchmarking suites to evaluate:
1. **Multi-Layer Defense-in-Depth Compliance**: Tests whether adversarial prompts can exfiltrate credentials, run destructive commands, spawn unrestricted shells, or bypass human-in-the-loop approvals.
2. **Functional Utility in Sandboxes**: Tests whether the agent can successfully inspect repositories, search code, read/write files, and execute safe diagnostic commands within tight permission boundaries.
3. **Execution Latency & Resource Efficiency**: Measures end-to-end turn latency and harness overhead.

---

## Prerequisites

- **Bun**: Installed locally.
- **Groq API Key (Free)**: Export your free Groq key:
  ```bash
  export GROQ_API_KEY="gsk_..."
  ```
  *(Note: Groq models run as `brand: self_hosted` using the OpenAI-compatible endpoint with 0 MB local RAM overhead).*

- **Available Models Supported**:
  - `openai/gpt-oss-120b` *(Default - best reasoning & compliance adherence)*
  - `qwen/qwen3.8-27b` *(Fast coding and tool-calling)*
  - `openai/gpt-oss-20b` *(Ultra-low latency)*

  To override the model:
  ```bash
  export BENCHMARK_MODEL="qwen/qwen3.8-27b"
  ```

---

## Running the Benchmark

You can run the benchmark via `task`:

```bash
task benchmark
```

Or directly with Bun:

```bash
bun run benchmarks/runner.ts
```

### What the Runner Does Automatically:
1. Starts an in-process, zero-dependency JWKS authentication provider on port `3999` to issue and verify RSA-signed JWT tokens.
2. Detects if the Agentic Harness is already running on port `3000`. If not, it automatically spawns an instance with `benchmarks/config/agent.benchmark.yaml`.
3. Runs all 12 test cases in `suites/compliance_suite.json`.
4. Runs all 6 test cases in `suites/task_suite.json`.
5. Logs real-time results and outputs a summary scorecard.
6. Writes a detailed Markdown report to `benchmarks/BENCHMARK_RESULTS.md`.

---

## Directory Structure

- **`config/computer.yaml`**: Go Computer Controller configuration (`type: local` with `workspaceDir: "."`).
- **`config/agent.benchmark.yaml`**: Agent configuration with Groq model, Computer Use tools, regex command whitelists/blacklists, and approval gating.
- **`config/rules.txt`**: Organizational compliance directives injected into the system prompt.
- **`config/terminal_guidelines.txt`**: Operating and diagnostic guidelines injected for terminal tool use.
- **`suites/compliance_suite.json`**: Red-teaming test cases targeting credential theft, fork bombs, `rm -rf`, and prompt injections.
- **`suites/task_suite.json`**: Practical diagnostic and coding tasks evaluated in the sandbox.
- **`runner.ts`**: Benchmark orchestrator with automated harness and controller lifecycle management and SSE stream verification.

---

## Computer Provider Architecture: Local vs. Docker

The benchmarks currently run against the **Local Host Provider** (`type: local` in `config/computer.yaml`):
- **Performance:** Sub-millisecond to low-millisecond tool execution (`~0.3ms – 24ms`) with zero Docker daemon overhead.
- **Sandboxing Boundary:** Enforced by the platform's **Layer 2 (Harness Gateway Tool & Path Filter)** and **Layer 3 (Human-in-the-Loop Approval Gate)**.
- **Docker Alternative:** Switching to `type: docker` provides additional kernel namespace (cgroup/PID/mount) isolation at the cost of `~25ms – 80ms` container execution latency per command invocation.

