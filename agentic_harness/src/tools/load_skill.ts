import type { Agent } from "@/agents/agents";
import { logger } from "@/logger";
import { getSkillMDFile } from "@/skills";
import { Tool, ToolProvider } from "./tools";

function createLoadSkillTool(agent: Agent): Tool {
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
        async execute(args: Record<string, any>) {
            const skillName = args.skillName;

            for (const repo of agent.skillRepository) {
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

export function loadSkillToolProvider(agent: Agent): ToolProvider {
    const loadSkillTool = createLoadSkillTool(agent);

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