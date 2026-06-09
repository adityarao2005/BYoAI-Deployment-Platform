
/*
Interface representing a skill that can be executed by an agent. A skill
consists of front matter (metadata) and body content (the actual
implementation of the skill).

TODO: Update the structure to match spec in
https://agentskills.io/specification#skill-md-format
*/
export interface SkillFrontMatter {
    name: string;
    description: string;

}

export interface Skill {
    frontMatter: SkillFrontMatter;
    body: string;
}

export interface SkillRepository {
    getAllSkills(): Promise<Skill[]>;
    getSkillByName(name: string): Promise<Skill | null>;
}