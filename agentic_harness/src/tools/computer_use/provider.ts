import { ToolProviderConfig, RemoteComputerUseToolProviderConfig, LocalComputerUseToolProviderConfig, } from "@/config/tool_config";
import { Tool, ToolProvider, toolProviderRegistry } from "../tools";
import { toolArray, toolBoolean, toolInteger, toolObject, toolString } from "../tool_argument";
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
        const response = await this.computerProviderService.getComputerInfo({
            sessionId: this.computerId
        });

        const tools: Tool[] = [];
        const basicTools = this.createBasicTools();

        switch (response.type) {
            case ComputerType.UNSPECIFIED:
                throw new Error("Computer does not exist.. this was not supposed to happen");
            case ComputerType.GRAPHICAL: {
                this.graphicalComputerService = createClient(GraphicalComputerService, this.transport);
                const graphicalTools = this.createGraphicalTools();
                tools.push(...basicTools, ...graphicalTools);
                break;
            }
            case ComputerType.HEADLESS: {
                tools.push(...basicTools);
                break;
            }
        }

        return tools;
    }

    private createBasicTools(): Tool[] {
        return [
            {
                name: "execute",
                description: "Execute a command on the computer shell.",
                inputSchema: toolObject(
                    "Execute command inputs",
                    {
                        command: toolString("The command to execute on the shell."),
                        cwd: toolString("Working directory for the command execution."),
                        envVars: toolObject("Environment variables key-value map.", {}, undefined, true),
                        stdin: toolString("Input data for standard input."),
                        shell: toolString("Custom shell executable."),
                        shellArgs: toolArray(toolString("Shell argument"), "Arguments for the shell.")
                    },
                    ["command"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const response = await this.basicComputerService.execute({
                        sessionId: this.computerId,
                        command: args.command,
                        cwd: args.cwd,
                        envVars: args.envVars || args.env_vars || {},
                        stdin: args.stdin,
                        shell: args.shell,
                        shellArgs: args.shellArgs || args.shell_args || []
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "execResult":
                            return response.result.value;
                        default:
                            throw new Error("Unexpected execute response");
                    }
                }
            },
            {
                name: "read_file",
                description: "Read content from a file on the computer.",
                inputSchema: toolObject(
                    "Read file inputs",
                    {
                        path: toolString("Path to the file to read."),
                        offset: toolInteger("Optional byte offset to start reading from."),
                        limit: toolInteger("Optional maximum bytes to read.")
                    },
                    ["path"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const response = await this.basicComputerService.readFile({
                        sessionId: this.computerId,
                        path: args.path,
                        offset: args.offset !== undefined ? BigInt(args.offset) : undefined,
                        limit: args.limit
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "content":
                            return { content: response.result.value };
                        default:
                            throw new Error("Unexpected read_file response");
                    }
                }
            },
            {
                name: "write_file",
                description: "Write content to a file on the computer.",
                inputSchema: toolObject(
                    "Write file inputs",
                    {
                        path: toolString("Path to the file to write."),
                        content: toolString("Content to write to the file."),
                        append: toolBoolean("Whether to append content to existing file.")
                    },
                    ["path", "content"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const rawContent = args.content;
                    const content = typeof rawContent === "string" ? new TextEncoder().encode(rawContent) : rawContent;
                    const response = await this.basicComputerService.writeFile({
                        sessionId: this.computerId,
                        path: args.path,
                        content: content,
                        append: args.append
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "resp":
                            return { success: true };
                        default:
                            throw new Error("Unexpected write_file response");
                    }
                }
            },
            {
                name: "list_directory",
                description: "List contents of a directory on the computer.",
                inputSchema: toolObject(
                    "List directory inputs",
                    {
                        path: toolString("Directory path to list.")
                    },
                    ["path"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const response = await this.basicComputerService.listDirectory({
                        sessionId: this.computerId,
                        path: args.path
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return response.result.value;
                        default:
                            throw new Error("Unexpected list_directory response");
                    }
                }
            },
            {
                name: "get_user_id",
                description: "Get the current user ID on the computer.",
                inputSchema: toolObject("Get user ID inputs", {}),
                execute: async () => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const response = await this.basicComputerService.getUserId({
                        sessionId: this.computerId
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "userId":
                            return { userId: response.result.value };
                        default:
                            throw new Error("Unexpected get_user_id response");
                    }
                }
            },
            {
                name: "get_group_id",
                description: "Get the current group ID on the computer.",
                inputSchema: toolObject("Get group ID inputs", {}),
                execute: async () => {
                    if (!this.basicComputerService) throw new Error("BasicComputerService is not initialized");
                    const response = await this.basicComputerService.getGroupId({
                        sessionId: this.computerId
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "groupId":
                            return { groupId: response.result.value };
                        default:
                            throw new Error("Unexpected get_group_id response");
                    }
                }
            }
        ];
    }

    private createGraphicalTools(): Tool[] {
        return [
            {
                name: "capture_screenshot",
                description: "Capture a screenshot of the computer screen.",
                inputSchema: toolObject(
                    "Capture screenshot inputs",
                    {
                        x: toolInteger("Optional top-left X coordinate for crop region."),
                        y: toolInteger("Optional top-left Y coordinate for crop region."),
                        width: toolInteger("Optional width for crop region."),
                        height: toolInteger("Optional height for crop region.")
                    }
                ),
                execute: async (args: Record<string, any> = {}) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.captureScreenshot({
                        sessionId: this.computerId,
                        x: args.x,
                        y: args.y,
                        width: args.width,
                        height: args.height
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return response.result.value;
                        default:
                            throw new Error("Unexpected capture_screenshot response");
                    }
                }
            },
            {
                name: "click",
                description: "Click mouse at specified coordinates.",
                inputSchema: toolObject(
                    "Click inputs",
                    {
                        x: toolInteger("X coordinate for click."),
                        y: toolInteger("Y coordinate for click."),
                        button: toolString("Mouse button (e.g. left, right, middle).")
                    },
                    ["x", "y"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.click({
                        sessionId: this.computerId,
                        x: args.x,
                        y: args.y,
                        button: args.button
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected click response");
                    }
                }
            },
            {
                name: "type",
                description: "Type text into the active window.",
                inputSchema: toolObject(
                    "Type inputs",
                    {
                        text: toolString("Text to type.")
                    },
                    ["text"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.type({
                        sessionId: this.computerId,
                        text: args.text
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected type response");
                    }
                }
            },
            {
                name: "press_key",
                description: "Press a key on the keyboard.",
                inputSchema: toolObject(
                    "Press key inputs",
                    {
                        key: toolString("Key name to press.")
                    },
                    ["key"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.pressKey({
                        sessionId: this.computerId,
                        key: args.key
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected press_key response");
                    }
                }
            },
            {
                name: "release_key",
                description: "Release a key on the keyboard.",
                inputSchema: toolObject(
                    "Release key inputs",
                    {
                        key: toolString("Key name to release.")
                    },
                    ["key"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.releaseKey({
                        sessionId: this.computerId,
                        key: args.key
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected release_key response");
                    }
                }
            },
            {
                name: "press_and_hold_key",
                description: "Press and hold a key on the keyboard.",
                inputSchema: toolObject(
                    "Press and hold key inputs",
                    {
                        key: toolString("Key name to press and hold.")
                    },
                    ["key"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.pressAndHoldKey({
                        sessionId: this.computerId,
                        key: args.key
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected press_and_hold_key response");
                    }
                }
            },
            {
                name: "release_all_keys",
                description: "Release all held keys on the keyboard.",
                inputSchema: toolObject("Release all keys inputs", {}),
                execute: async () => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.releaseAllKeys({
                        sessionId: this.computerId
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected release_all_keys response");
                    }
                }
            },
            {
                name: "drag",
                description: "Drag mouse from starting coordinates to ending coordinates.",
                inputSchema: toolObject(
                    "Drag inputs",
                    {
                        x1: toolInteger("Start X coordinate."),
                        y1: toolInteger("Start Y coordinate."),
                        x2: toolInteger("End X coordinate."),
                        y2: toolInteger("End Y coordinate.")
                    },
                    ["x1", "y1", "x2", "y2"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.drag({
                        sessionId: this.computerId,
                        x1: args.x1,
                        y1: args.y1,
                        x2: args.x2,
                        y2: args.y2
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected drag response");
                    }
                }
            },
            {
                name: "move_mouse_to",
                description: "Move mouse cursor to coordinates.",
                inputSchema: toolObject(
                    "Move mouse to inputs",
                    {
                        x: toolInteger("X coordinate."),
                        y: toolInteger("Y coordinate.")
                    },
                    ["x", "y"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.moveMouseTo({
                        sessionId: this.computerId,
                        x: args.x,
                        y: args.y
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected move_mouse_to response");
                    }
                }
            },
            {
                name: "scroll",
                description: "Scroll screen horizontally or vertically.",
                inputSchema: toolObject(
                    "Scroll inputs",
                    {
                        dx: toolInteger("Horizontal scroll delta."),
                        dy: toolInteger("Vertical scroll delta.")
                    },
                    ["dx", "dy"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.scroll({
                        sessionId: this.computerId,
                        dx: args.dx,
                        dy: args.dy
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected scroll response");
                    }
                }
            },
            {
                name: "get_clipboard",
                description: "Get text content from the clipboard.",
                inputSchema: toolObject("Get clipboard inputs", {}),
                execute: async () => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.getClipboard({
                        sessionId: this.computerId
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "text":
                            return { text: response.result.value };
                        default:
                            throw new Error("Unexpected get_clipboard response");
                    }
                }
            },
            {
                name: "set_clipboard",
                description: "Set text content in the clipboard.",
                inputSchema: toolObject(
                    "Set clipboard inputs",
                    {
                        text: toolString("Text to set in clipboard.")
                    },
                    ["text"]
                ),
                execute: async (args: Record<string, any>) => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.setClipboard({
                        sessionId: this.computerId,
                        text: args.text
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return { success: true };
                        default:
                            throw new Error("Unexpected set_clipboard response");
                    }
                }
            },
            {
                name: "get_screen_size",
                description: "Get the screen size dimensions.",
                inputSchema: toolObject("Get screen size inputs", {}),
                execute: async () => {
                    if (!this.graphicalComputerService) throw new Error("GraphicalComputerService is not initialized");
                    const response = await this.graphicalComputerService.getScreenSize({
                        sessionId: this.computerId
                    });

                    switch (response.result.case) {
                        case "errorMessage":
                            throw new Error(response.result.value);
                        case "response":
                            return response.result.value;
                        default:
                            throw new Error("Unexpected get_screen_size response");
                    }
                }
            }
        ];
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
    const providerConfig = providers[0];
    if (!providerConfig) return;

    const providerType = providerConfig.provider.type;
    let toolProvider: ToolProvider;
    switch (providerType) {
        case "local":
            toolProvider = new LocalComputerUseToolProvider(providerConfig.provider);
            // register the tool to the agent
            toolProviderRegistry.registerToolProvider(toolProvider);
            break;
        case "remote":
            toolProvider = new RemoteComputerUseToolProvider(providerConfig.provider);
            // register the tool to the agent
            toolProviderRegistry.registerToolProvider(toolProvider);
            break;
        default:
            throw new Error(`Unknown type provided: ${providerType}`);
    }
}