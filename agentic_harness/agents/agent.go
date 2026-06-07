package agents

import (
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/models"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/skills"
)

/*
Represents an AI Agent.
*/
type Agent struct {
	name   string                   // The name of the agent
	skills []skills.SkillRepository // The skill repository associated with the agent
	model  models.Model             // The underlying model used by the agent (e.g., "gpt-4")
}
