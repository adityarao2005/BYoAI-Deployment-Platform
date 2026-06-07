package skills

/*
Interface representing a skill that can be executed by an agent. A skill
consists of front matter (metadata) and body content (the actual
implementation of the skill).

TODO: Update the structure to match spec in
https://agentskills.io/specification#skill-md-format
*/
type Skill struct {
	frontMatter map[string]any // Metadata about the skill (e.g., name, description, parameters)
	body        string         // The actual implementation of the skill
}

/*
Gets the front matter of the skill, which contains metadata such as name and
description.
*/
func (s *Skill) GetFrontMatter() map[string]any {
	return s.frontMatter
}

/*
Gets the body content of the skill, which contains the actual implementation
of the skill.
*/
func (s *Skill) GetBody() string {
	return s.body
}

/*
Gets the name of the skill from the front matter.
*/
func (s *Skill) GetName() string {
	return s.GetFrontMatter()["name"].(string)
}

/*
Gets the description of the skill from the front matter.
*/
func (s *Skill) GetDescription() string {
	return s.GetFrontMatter()["description"].(string)
}

/*
Repository interface for managing and retrieving skills. This interface
defines methods for accessing the collection of skills available in the
system. Implementations of this interface
will provide the logic for storing and retrieving skills, which can be used
by agents to perform various tasks.

TODO: Create different types of skill repositories (e.g., file-based, database-based, API-based)
*/
type SkillRepository interface {
	/*
	  Gets a list of all available skills in the repository.
	*/
	getAllSkills() ([]Skill, error)
}
