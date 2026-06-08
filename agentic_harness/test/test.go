package test

import (
	"os"
	"testing"
)

// Sets up the test for unit testing
func SetupUnitTest(t *testing.T) {
	t.Parallel()
}

// Sets up the test for integration testing
func SetupIntegrationTest(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode.")
	}
}

func GetSelfHostedModelBaseUri() string {

	uri := os.Getenv("SELF_HOSTED_MODEL_BASE_URI")
	if uri != "" {
		return uri
	}

	// In a real implementation, this could read from environment variables or configuration files
	return "http://localhost:8000/v1"
}
