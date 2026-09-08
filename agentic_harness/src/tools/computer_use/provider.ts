import { ToolProviderConfig, RemoteComputerUseToolProviderConfig, LocalComputerUseToolProviderConfig, } from "@/config/tool_config";
import { Tool, ToolProvider, toolProviderRegistry } from "../tools";
import { createConnectTransport } from "@connectrpc/connect-node";
import { Client, createClient, Transport } from "@connectrpc/connect";
import { BasicComputerService, ComputerProviderService, ComputerType, GraphicalComputerService } from "@/gen/computer_api/v1/computer_pb";


// abstract computer use tool provider
abstract class ComputerUseToolProvider implements ToolProvider {
    private cachedTools: Tool[] | null = null

    abstract createTools(): Promise<Tool[]>

    private async loadTools(): Promise<Tool[]> {
        if (!this.cachedTools) {
            this.cachedTools = await this.createTools()
        }

        return this.cachedTools
    }

    async getToolByName(name: string): Promise<Tool | null> {
        const tools = await this.loadTools();
        return tools.find(tool => tool.name === name) || null;
    }

    async getAllTools(): Promise<Tool[]> {
        return this.loadTools();
    }
}

// local computer
export class LocalComputerUseToolProvider extends ComputerUseToolProvider {
    config: LocalComputerUseToolProviderConfig

    constructor(config: LocalComputerUseToolProviderConfig) {
        super()
        this.config = config
    }

    async createTools(): Promise<Tool[]> {
        return []
    }
}

export class RemoteComputerUseToolProvider extends ComputerUseToolProvider {
    transport: Transport | null = null
    config: RemoteComputerUseToolProviderConfig
    computerProviderService: Client<typeof ComputerProviderService> | null = null
    basicComputerService: Client<typeof BasicComputerService> | null = null
    graphicalComputerService: Client<typeof GraphicalComputerService> | null = null
    computerId: string = ""

    constructor(config: RemoteComputerUseToolProviderConfig) {
        super()
        this.config = config
    }

    async createTools(): Promise<Tool[]> {
        this.transport = createConnectTransport({
            baseUrl: this.config.url,
            httpVersion: "2",
        })

        this.computerProviderService = createClient(ComputerProviderService, this.transport)
        this.basicComputerService = createClient(BasicComputerService, this.transport)

        // create the computer
        {
            const response = await this.computerProviderService.createComputer({
                image: this.config.image
            })

            switch (response.result.case) {
                case "errorMessage":
                    throw new Error(response.result.value)
                case "sessionId":
                    this.computerId = response.result.value
                    break;
            }
        }

        // get information about the computer
        {
            const response = await this.computerProviderService.getComputerInfo({
                sessionId: this.computerId
            })

            switch (response.type) {
                case ComputerType.UNSPECIFIED:
                    throw new Error("Computer does not exist.. this was not supposed to happen")
                case ComputerType.GRAPHICAL:
                    // add all the graphical tools
                case ComputerType.HEADLESS:
                    // add all the headless tools
                    
            }
        }


        this.graphicalComputerService = createClient(GraphicalComputerService, this.transport)


        return []
    }
}

export function registerComputerUseToolProvider(config: ToolProviderConfig[]) {
    const providers = []

    for (const providerConfig of config) {
        if (providerConfig.type === "computer") {
            providers.push(providerConfig)
        }
    }

    if (providers.length === 0)
        return;

    if (providers.length > 1) {
        throw new Error(`There should only be 1 computer use tool provider declared, currently these are the declared computer tool providers: ${providers}`)
    }

    // get the provider config
    const providerConfig = providers[0]

    // provide the tool
    var toolProvider: ToolProvider;
    switch (providerConfig?.provider.type) {
        case "local":
            toolProvider = new LocalComputerUseToolProvider(providerConfig.provider)
            // register the tool to the agent
            toolProviderRegistry.registerToolProvider(toolProvider)
            break;
        case "remote":
            toolProvider = new RemoteComputerUseToolProvider(providerConfig.provider)
            // register the tool to the agent
            toolProviderRegistry.registerToolProvider(toolProvider)
        default:
            throw new Error(`Unkown type provided: ${providerConfig?.provider.type}`)
    }

}