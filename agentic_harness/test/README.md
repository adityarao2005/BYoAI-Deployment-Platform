# Testing

You may create any tests using the builtin golang "testing" package but for unit tests you should setup them with the `SetupUnitTest` method and integration tests (which require a model) with `SetupIntegrationTest`.