import { logger } from "@/logger";
import { modelRegistry } from "@/models";
import { isToolCallRequest, ModelInteraction, ToolCallRequest, ToolCallResponse } from "@/models/conversation";
import { SkillRepository } from "@/skills";
import { loadSkillToolProvider } from "@/tools/load_skill";
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
        this.toolProviders.push(loadSkillToolProvider(this));
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
        </skill>`.trim()
        ).join("\n")}
</available_skills>
        `.trim();
    }
}