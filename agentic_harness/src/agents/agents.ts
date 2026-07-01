import { logger } from "@/logger";
import { modelRegistry } from "@/models";
import { isToolCallRequest, ModelInteraction, ToolCallRequest, ToolCallResponse } from "@/models/conversation";
import { SkillRepository } from "@/skills/skills";
import { ToolProvider } from "@/tools/tools";

async function executeTool(request: ToolCallRequest): Promise<ToolCallResponse> {
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
    systemPrompt?: string | undefined; // TODO: remove the system prompt from here and create a utility method which constructs the system prompt given the agent's purpose, rules, skills, and tools. The system prompt should be constructed by the agent itself and not passed in from the outside.
}

export class Agent {
    private name: string;
    private skillRepository: SkillRepository[];
    private toolProviders: ToolProvider[];

    constructor(name: string, skillRepository: SkillRepository[], toolProviders: ToolProvider[]) {
        this.name = name;
        this.skillRepository = skillRepository;
        this.toolProviders = toolProviders;
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
                systemPrompt: input.systemPrompt,
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
            systemPrompt: input.systemPrompt
        };
    }

}