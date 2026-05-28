# Local Model install


For our tests, we'll be using `gemma 4 E2B` to help us testing. We'll first have to install it.

### Installing gemma-4 e2b

1. First install uv: https://github.com/astral-sh/uv
2. Run `uv sync`
3. Run `hf download --local-dir ./dist/ ggml-org/gemma-4-E4B-it-GGUF` to install it to the `dist`

### Running the model

Run `docker compose up` and it should be available at `http://localhost:8080`