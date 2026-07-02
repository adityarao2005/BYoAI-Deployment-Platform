import { logger } from "@/logger";
import { modelRegistry } from "@/models";
import { isToolCallRequest, ModelInteraction, ToolCallRequest, ToolCallResponse } from "@/models/conversation";
import { getSkillMDFile, SkillRepository } from "@/skills";
import { validateToolArgument } from "@/tools/tool_argument";
import { Tool, ToolProvider } from "@/tools/tools";

async function executeTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    if (!validateToolArgument(request.tool.inputSchema, request.arguments)) {
        throw new Error(`Invalid arguments for tool ${request.tool.name}`);
    }

    const output = await request.tool.execute(request.arguments);

    logger.info(`Tool ${request.tool.name} executed with arguments ${JSON.stringify(request.arguments)}. Output: ${JSON.stringify(output)}`);

    return {
        type: 'tool_response',
        result: output,
        tool: request.tool,
        id: request.id
    };
}

export type AgentConversation = {
    history: ModelInteraction[];
}

function skillToolProvider(agent: Agent): ToolProvider {

    // load skill tool
    const loadSkillTool: Tool = {
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

        // executing of the load skill tool will search through the agent's skill repositories for the skill and load it into the agent's memory if found
        async execute(args: Record<string, any>) {
            const skillName = args.skillName;

            for (const repo of agent.skillRepository) {
                const skill = await repo.getSkillByName(skillName);
                if (skill) {
                    logger.info(`Skill ${skillName} loaded into agent's memory.`);
                    return {
                        success: true,
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
    }

    // skill tool provider will provide the load skill tool to the agent  
    return {
        async getAllTools() {
            return [loadSkillTool]
        },

        async getToolByName(name) {
            if (name === loadSkillTool.name) {
                return loadSkillTool
            }
            return null
        }
    }
}

export class Agent {
    name: string;
    readonly skillRepository: SkillRepository[];
    readonly toolProviders: ToolProvider[];
    readonly description: string;

    constructor(name: string,
        skillRepository: SkillRepository[],
        toolProviders: ToolProvider[],
        description: string = "You are a helpful agent.") {
        // set the values
        this.name = name;
        this.skillRepository = skillRepository;
        this.toolProviders = toolProviders;
        this.description = description;
        // add the skill tool provider to the agent's tool providers
        this.toolProviders.push(skillToolProvider(this));
    }

    /*
    Performs a task using the agent's skills and tools. This is a placeholder
    implementation and should be expanded to include the actual logic for
    executing tasks based on the agent's capabilities.
    */
    public async performTask(input: AgentConversation): Promise<AgentConversation> {

        // get the models
        const model = modelRegistry.getDefaultModel();

        if (!model) {
            throw new Error("No model registered in the model registry. Cannot perform task.");
        }

        // get the tools
        const tools = (await Promise.all(
            this.toolProviders.map((provider) =>
                provider.getAllTools())))
            // flatten the array of arrays into a single array of tools
            .flatMap(e => e);

        // create the model
        const messages: ModelInteraction[] = input.history ? [...input.history] : [];

        do {
            // get the output from the model
            const output = await model.execute({
                history: messages,
                systemPrompt: await this.constructSystemPrompt(),
                tools
            });

            logger.info(`Model output: ${JSON.stringify(output)}`);

            // add the output to the messages
            messages.push(...output);

            // check if the output contains a tool call request
            const toolCallRequest = output.filter(isToolCallRequest);

            if (toolCallRequest.length === 0) {
                logger.info("No tool call request found in model output. Ending task execution.");

                break
            }

            logger.info(`Tool call request found: ${JSON.stringify(toolCallRequest)}`);

            // execute the tool call requests
            const toolResponses = await Promise.all(
                toolCallRequest.map(executeTool))

            // push all the tool call responses
            messages.push(...toolResponses)

            logger.info(`Tool responses: ${JSON.stringify(toolResponses)}`);
        }
        while (true);

        // set the output to the input, set the history and return
        return {
            history: messages,
        };
    }

    private async constructSystemPrompt(): Promise<string> {

        const skills = (await Promise.all(this.skillRepository.map(repo => repo.getAllSkills())))
            .flatMap(e => e);

        return `
## Who you are:

You are an AI Agent named ${this.name}.

## Your purpose:

${this.description}

## Your skills:

<available_skills>
    ${skills.map(skill => `
        <skill>
            <name>${skill.frontMatter.name}</name>
            <description><![CDATA[${skill.frontMatter.description}]]></description>
            ${skill.assetLocation ? `<assetLocation>${skill.assetLocation}</assetLocation>` : ""}
        </skill>`.trim()
        ).join("\n")}
</available_skills>
        `.trim();
    }
}