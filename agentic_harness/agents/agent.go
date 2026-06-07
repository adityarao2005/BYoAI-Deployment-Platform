package agents

import (
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/models"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/skills"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/agentic_harness/tools"
)

/*
Represents an AI Agent.
*/
type Agent struct {
	name              string                   // The name of the agent
	model             models.Model             // The underlying model used by the agent (e.g., "gpt-4")
	skillRepositories []skills.SkillRepository // The skill repository associated with the agent
	toolProviders     []tools.ToolProvider     // The tool providers associated with the agent
}

/*
Creates a new agent with the given name, model, skill repositories, and tool providers.
*/
func NewAgent(name string, model models.Model, skillRepos []skills.SkillRepository, toolProviders []tools.ToolProvider) *Agent {
	return &Agent{
		name:              name,
		model:             model,
		skillRepositories: skillRepos,
		toolProviders:     toolProviders,
	}
}

/*
Gets the name of the agent.
*/
func (a *Agent) GetName() string {
	return a.name
}

/*
Gets the model of the agent.
*/
func (a *Agent) GetModel() models.Model {
	return a.model
}

/*
Sets the model of the agent.
*/
func (a *Agent) SetModel(model models.Model) {
	a.model = model
}

/*
Gets the skill repositories associated with the agent.
*/
func (a *Agent) GetSkillRepositories() []skills.SkillRepository {
	return a.skillRepositories
}

/*
Sets the skill repositories associated with the agent.
*/
func (a *Agent) SetSkillRepositories(skillRepos []skills.SkillRepository) {
	a.skillRepositories = skillRepos
}

/*
Gets the tool providers associated with the agent.
*/
func (a *Agent) GetToolProviders() []tools.ToolProvider {
	return a.toolProviders
}

/*
Sets the tool providers associated with the agent.
*/
func (a *Agent) SetToolProviders(toolProviders []tools.ToolProvider) {
	a.toolProviders = toolProviders
}

/*
Performs a task using the agent's skills and tools. This is a placeholder
implementation and should be expanded to include the actual logic for
executing tasks based on the agent's capabilities.
*/
func (a *Agent) PerformTask(task string) (string, error) {
	return a.model.Execute([]models.Message{
		{
			Role:        "user",
			MessageType: "text",
			Content:     task,
		},
	})
}
