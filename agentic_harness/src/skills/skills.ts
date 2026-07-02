
/*
Interface representing a skill that can be executed by an agent. A skill
consists of front matter (metadata) and body content (the actual
implementation of the skill).

TODO: Update the structure to match spec in
https://agentskills.io/specification#skill-md-format
*/
export type SkillFrontMatter = {
    name: string;
    description: string;
    license?: string
    compatibility?: string
    metadata?: Record<string, unknown>
}

export type Skill = {
    frontMatter: SkillFrontMatter;
    body: string;

    // where we store the skill's assets (if any) for the agent to use. This is a path to the directory where the skill's assets are stored.
    assetLocation?: string
}

export function getSkillMDFile(skill: Skill): string {
    return `---
name: ${skill.frontMatter.name}
description: ${skill.frontMatter.description}
${skill.frontMatter.license ? `license: ${skill.frontMatter.license}` : ""}
${skill.frontMatter.compatibility ? `compatibility: ${skill.frontMatter.compatibility}` : ""}
${skill.frontMatter.metadata ? `metadata: ${JSON.stringify(skill.frontMatter.metadata)}` : ""}
---
${skill.body}
`
}

export interface SkillRepository {
    getAllSkills(): Promise<Skill[]>;
    getSkillByName(name: string): Promise<Skill | null>;

}

export class SkillRepositoryRegistry {
    private registry: SkillRepository[] = [];

    registerSkillRepository(repo: SkillRepository) {
        this.registry.push(repo);
    }

    getAllSkillRepositories(): SkillRepository[] {
        return this.registry;
    }
}

export const skillRepositoryRegistry = new SkillRepositoryRegistry();