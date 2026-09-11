import type { Agent, AgentSession } from "@/agents/agents";
import { logger } from "../logger";
import { getSkillMDFile, type SkillRepository } from "@/skills";
import type { Tool, ToolProvider } from "./tools";

function createLoadSkillTool(repositories?: SkillRepository[]): Tool {
    return {
        name: "load_skill",
        description: "Load a skill into the agent's memory.",
        inputSchema: {
            type: "object",
            description: "The skill to load into the agent's memory.",
            properties: {
                skillName: {
                    type: "string",
                    description: "The name of the skill to load."
                }
            },
            required: ["skillName"]
        },
        async execute(args: Record<string, any>, session?: AgentSession) {
            const skillName = args.skillName;
            const repos = session?.skillRepositories ?? repositories ?? [];

            for (const repo of repos) {
                const skill = await repo.getSkillByName(skillName);
                if (skill) {
                    logger.info(`Skill ${skillName} loaded into agent's memory.`);
                    return {
                        success: true,
                        location: skill.assetTargetLocation,
                        content: getSkillMDFile(skill)
                    };
                }
            }

            logger.warn(`Skill ${skillName} not found in any of the agent's skill repositories.`);
            return {
                success: false,
                message: `Skill ${skillName} not found.`
            };
        }
    };
}

export function loadSkillToolProvider(agentOrRepos?: Agent | SkillRepository[]): ToolProvider {
    let repos: SkillRepository[] | undefined;
    if (Array.isArray(agentOrRepos)) {
        repos = agentOrRepos;
    }
    const loadSkillTool = createLoadSkillTool(repos);

    return {
        async getAllTools() {
            return [loadSkillTool];
        },

        async getToolByName(name) {
            if (name === loadSkillTool.name) {
                return loadSkillTool;
            }

            return null;
        }
    };
}