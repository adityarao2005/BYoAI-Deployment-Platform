package test

import (
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
