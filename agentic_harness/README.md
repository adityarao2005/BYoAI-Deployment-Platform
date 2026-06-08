# The Agentic Harness

This golang module is the the code for the agentic harness.

The following packages exist:
- `models` which contains abstractions for the AI Models
- `skills` which contains abstractions for the Skills which an AI Agent can use
- `tools` which contains abstractions for the tools which an AI can use
- `agents` for the harness which bridges all of the above together
- `test` for some helper methods used for unit and integration tests

You can use the following taskfile methods:
- `task clean` to clean the build and all unnecessary files
- `task build` to build the go module
- `task run` to run the built go application
- `task unit_test` to run the unit tests for the go module
- `task full_test` to run the integration tests for the go module. **Note:** you'd need to have the local model in [../local_models/](../local_models/) folder running (or any local model which is OpenAI API Chat Completions Spec Compliant) running at http://localhost:8080/v1 in order for this to work. You may learn more info on how to get this running by checking [README.md](../local_models/README.md).

# Testing

You may create any tests using the builtin golang "testing" package but there are some configurations needed for certain types of testing:
- for unit tests you should setup them with the `SetupUnitTest` method
- for integration tests (which require a model) with `SetupIntegrationTest` and use the `GetSelfHostedModelBaseUri` method to access the model.

