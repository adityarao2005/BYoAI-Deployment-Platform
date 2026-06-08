package models

import (
	"testing"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/test"
)


func TestSelfHostedModelExecution(t *testing.T) {
	test.SetupIntegrationTest(t)

	model := NewSelfHostedModel(test.GetSelfHostedModelBaseUri())

	response, err := model.Execute([]Message{
		{Role: User, Content: "Hello, how are you?"},
	})
	if err != nil {
		t.Fatalf("Failed to execute model: %v", err)
	}
	if response == "" {
		t.Errorf("Expected a response from the model, got an empty string")
	}
}
