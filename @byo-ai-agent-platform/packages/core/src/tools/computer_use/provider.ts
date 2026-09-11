import type { Agent } from "@/agents";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import { createGraphicalTools, createHeadlessTools, type ComputerProvider, type Tool, type ToolProvider } from "@/tools";

// abstract computer use tool provider
export class ComputerUseToolProvider implements ToolProvider {
    // hash based on agent name
    private cachedTools: Map<string, Tool[]> = new Map();
    private provider: ComputerProvider

    constructor(provider: ComputerProvider) {
        this.provider = provider
    }

    async getToolByName(name: string, agent: Agent): Promise<Tool | null> {
        const tools = await this.getAllTools(agent);
        return tools.find(tool => tool.name === name) || null;
    }

    async getAllTools(agent: Agent): Promise<Tool[]> {
        const cacheKey = agent.name ?? agent.id;
        // prefetch cached tools
        const retrievedTools = this.cachedTools.get(cacheKey);
        if (retrievedTools !== undefined) {
            return retrievedTools;
        }

        // refetch them from the provider
        if (!agent.computerId)
            // TODO: once we build an AgentExecutor, we change this to create a new computer for the agent
            throw new Error(`The Agent is not registered with this tool provider and thus the agent does not have a computer id`);

        const payload = await this.provider.getComputer(agent.computerId);

        let tools: Tool[] = [];

        switch (payload.type) {
            case ComputerType.UNSPECIFIED:
                throw new Error("Something went wrong when trying to retrieve the computer, please check the computer provider logs");

            // headless tools
            case ComputerType.HEADLESS:
                tools = createHeadlessTools(payload.computer);
                break;

            // graphical toools
            case ComputerType.GRAPHICAL:
                tools = [
                    ...createHeadlessTools(payload.computer),
                    ...createGraphicalTools(payload.computer),
                ];
                break;
        }

        // cache the values
        this.cachedTools.set(cacheKey, tools);

        return tools;
    }
}
