import type { AgentHandle } from "@/agents";
import { ComputerType } from "@/gen/computer_api/v1/computer_pb";
import {
    type ComputerProvider,
    createGraphicalTools,
    createHeadlessTools,
    type Tool,
    type ToolProvider,
} from "@/tools";
import type { ComputerPermissions } from "./permissions";

// abstract computer use tool provider
export class ComputerUseToolProvider implements ToolProvider {
    // hash based on agent name
    private cachedTools: Map<string, Tool[]> = new Map();
    private provider: ComputerProvider;
    private permissions?: ComputerPermissions;

    constructor(
        provider: ComputerProvider,
        permissions?: ComputerPermissions,
    ) {
        this.provider = provider;
        this.permissions = permissions;
    }

    async getToolByName(
        name: string,
        agent: AgentHandle,
    ): Promise<Tool | null> {
        const tools = await this.getAllTools(agent);
        return tools.find((tool) => tool.name === name) || null;
    }

    async getAllTools(agent: AgentHandle): Promise<Tool[]> {
        const cacheKey = agent.name ?? agent.id;
        // prefetch cached tools
        const retrievedTools = this.cachedTools.get(cacheKey);
        if (retrievedTools !== undefined) {
            return retrievedTools;
        }

        // refetch them from the provider
        if (!agent.computerId)
            throw new Error(
                `The Agent is not registered with this tool provider and thus the agent does not have a computer id`,
            );

        const payload = await this.provider.getComputer(agent.computerId);

        let tools: Tool[] = [];

        switch (payload.type) {
            case ComputerType.UNSPECIFIED:
                throw new Error(
                    "Something went wrong when trying to retrieve the computer, please check the computer provider logs",
                );

            // headless tools
            case ComputerType.HEADLESS:
                tools = createHeadlessTools(
                    payload.computer,
                    this.permissions,
                );
                break;

            // graphical toools
            case ComputerType.GRAPHICAL:
                tools = [
                    ...createHeadlessTools(
                        payload.computer,
                        this.permissions,
                    ),
                    ...createGraphicalTools(payload.computer),
                ];
                break;
        }

        // cache the values
        this.cachedTools.set(cacheKey, tools);

        return tools;
    }
}
