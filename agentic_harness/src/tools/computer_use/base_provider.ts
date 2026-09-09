import { Tool, ToolProvider } from "../tools";

// abstract computer use tool provider
export abstract class ComputerUseToolProvider implements ToolProvider {
    private cachedTools: Tool[] | null = null;

    abstract createTools(): Promise<Tool[]>;

    private async loadTools(): Promise<Tool[]> {
        if (!this.cachedTools) {
            this.cachedTools = await this.createTools();
        }

        return this.cachedTools;
    }

    async getToolByName(name: string): Promise<Tool | null> {
        const tools = await this.loadTools();
        return tools.find(tool => tool.name === name) || null;
    }

    async getAllTools(): Promise<Tool[]> {
        return this.loadTools();
    }
}
