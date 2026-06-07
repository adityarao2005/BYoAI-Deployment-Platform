package test

import (
	"testing"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/agents"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/models"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/skills"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/tools"
)

const (
	DUMMY_MESSAGE = "Hello, I am a dummy model!"
)

type DummyModel struct {
}

func (m *DummyModel) Execute(messages []models.Message) (string, error) {
	return DUMMY_MESSAGE, nil
}

// Tests the creation of an agent with dummy parameters
func TestAgentCreation(t *testing.T) {

	agent := agents.NewAgent("New Agent", &DummyModel{}, []skills.SkillRepository{}, []tools.ToolProvider{})

	message, err := agent.PerformTask("Tell me your name")
	if err != nil {
		t.Fatalf("Failed to perform task: %v", err)
	}
	if message != DUMMY_MESSAGE {
		t.Errorf("Expected message '%s', got '%s'", DUMMY_MESSAGE, message)
	}
}
