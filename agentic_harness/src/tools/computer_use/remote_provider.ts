import { RemoteComputerUseToolProviderConfig } from "@/config/tool_config";
import { Tool } from "../tools";
import { ConnectTransportOptions, createConnectTransport } from "@connectrpc/connect-node";
import { Client, createClient, Interceptor, Transport } from "@connectrpc/connect";
import { BasicComputerService, ComputerProviderService, ComputerType, GraphicalComputerService } from "@/gen/computer_api/v1/computer_pb";
import { ComputerUseToolProvider } from "./base_provider";
import { buildComputerTools } from "./builder";
import dotenv from "dotenv";
import fs from "node:fs";
import {
    CaptureScreenshotArgs,
    CaptureScreenshotResult,
    ClickArgs,
    DragArgs,
    ExecuteArgs,
    ExecutionResult,
    GraphicalComputer,
    KeyArgs,
    ListDirectoryArgs,
    ListDirectoryResult,
    MoveMouseToArgs,
    ReadFileArgs,
    ReadFileResult,
    ScreenSizeResult,
    ScrollArgs,
    SetClipboardArgs,
    TypeArgs,
    WriteFileArgs,
} from "./computer";
import { ClientSessionOptions, SecureClientSessionOptions } from "node:http2";

export class ConnectRemoteComputer implements GraphicalComputer {
    constructor(
        private computerId: string,
        private basicService: Client<typeof BasicComputerService>,
        private graphicalService?: Client<typeof GraphicalComputerService>
    ) { }

    async execute(args: ExecuteArgs): Promise<ExecutionResult> {
        const response = await this.basicService.execute({
            sessionId: this.computerId,
            command: args.command,
            cwd: args.cwd,
            envVars: args.envVars || {},
            stdin: args.stdin,
            shell: args.shell,
            shellArgs: args.shellArgs || [],
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

    async readFile(args: ReadFileArgs): Promise<ReadFileResult> {
        const response = await this.basicService.readFile({
            sessionId: this.computerId,
            path: args.path,
            offset: args.offset !== undefined ? BigInt(args.offset) : undefined,
            limit: args.limit,
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

    async writeFile(args: WriteFileArgs): Promise<{ success: boolean }> {
        const rawContent = args.content;
        const content = typeof rawContent === "string" ? new TextEncoder().encode(rawContent) : rawContent;
        const response = await this.basicService.writeFile({
            sessionId: this.computerId,
            path: args.path,
            content,
            append: args.append,
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

    async listDirectory(args: ListDirectoryArgs): Promise<ListDirectoryResult> {
        const response = await this.basicService.listDirectory({
            sessionId: this.computerId,
            path: args.path,
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

    async getUserId(): Promise<{ userId: string }> {
        const response = await this.basicService.getUserId({
            sessionId: this.computerId,
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

    async getGroupId(): Promise<{ groupId: string }> {
        const response = await this.basicService.getGroupId({
            sessionId: this.computerId,
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

    async captureScreenshot(args: CaptureScreenshotArgs = {}): Promise<CaptureScreenshotResult> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.captureScreenshot({
            sessionId: this.computerId,
            x: args.x,
            y: args.y,
            width: args.width,
            height: args.height,
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

    async click(args: ClickArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.click({
            sessionId: this.computerId,
            x: args.x,
            y: args.y,
            button: args.button,
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

    async type(args: TypeArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.type({
            sessionId: this.computerId,
            text: args.text,
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

    async pressKey(args: KeyArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.pressKey({
            sessionId: this.computerId,
            key: args.key,
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

    async releaseKey(args: KeyArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.releaseKey({
            sessionId: this.computerId,
            key: args.key,
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

    async pressAndHoldKey(args: KeyArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.pressAndHoldKey({
            sessionId: this.computerId,
            key: args.key,
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

    async releaseAllKeys(): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.releaseAllKeys({
            sessionId: this.computerId,
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

    async drag(args: DragArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.drag({
            sessionId: this.computerId,
            x1: args.x1,
            y1: args.y1,
            x2: args.x2,
            y2: args.y2,
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

    async moveMouseTo(args: MoveMouseToArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.moveMouseTo({
            sessionId: this.computerId,
            x: args.x,
            y: args.y,
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

    async scroll(args: ScrollArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.scroll({
            sessionId: this.computerId,
            dx: args.dx,
            dy: args.dy,
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

    async getClipboard(): Promise<{ text: string }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.getClipboard({
            sessionId: this.computerId,
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

    async setClipboard(args: SetClipboardArgs): Promise<{ success: boolean }> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.setClipboard({
            sessionId: this.computerId,
            text: args.text,
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

    async getScreenSize(): Promise<ScreenSizeResult> {
        if (!this.graphicalService) throw new Error("GraphicalComputerService is not initialized");
        const response = await this.graphicalService.getScreenSize({
            sessionId: this.computerId,
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

async function loadCertOrFile(pathOrContent: string): Promise<string | Buffer> {
    try {
        const stat = await fs.promises.stat(pathOrContent);
        if (stat.isFile()) {
            return await fs.promises.readFile(pathOrContent);
        }
    } catch {
        // Not a valid file path, treat as raw PEM string content
    }
    return pathOrContent;
}

/**
 * Helper to build ConnectRPC Transport options (interceptors for auth, nodeOptions for mTLS/certs).
 */
export async function buildTransportOptions(
    config: RemoteComputerUseToolProviderConfig
): Promise<ConnectTransportOptions> {
    const interceptors: Interceptor[] = [];

    if (config.security?.apiKey) {
        const apiKey = config.security.apiKey;
        interceptors.push((next) => async (req) => {
            req.header.set("Authorization", `Bearer ${apiKey}`);
            return await next(req);
        });
    }

    const options: ConnectTransportOptions = {
        baseUrl: config.url,
        httpVersion: "2",
        interceptors,
    };

    if (config.security?.mtls?.clientCert) {
        const certData = await loadCertOrFile(config.security.mtls.clientCert);
        const nodeOptions: SecureClientSessionOptions = {
            cert: certData,
        };

        if (config.security.mtls.clientKey) {
            nodeOptions.key = await loadCertOrFile(config.security.mtls.clientKey);
        }

        if (config.security.mtls.caCert) {
            nodeOptions.ca = await loadCertOrFile(config.security.mtls.caCert);
        } else {
            // Fallback: If caCert is omitted, use clientCert as ca so full-chain PEM bundles work automatically
            nodeOptions.ca = certData;
        }

        options.nodeOptions = nodeOptions;
    }

    return options;
}

/**
 * Asynchronously loads .env file if specified and merges with environment config (config.environment takes priority).
 */
export async function resolveEnvironmentConfig(
    config: RemoteComputerUseToolProviderConfig
): Promise<Record<string, string>> {
    let envFromFile: Record<string, string> = {};
    if (config.envFile) {
        try {
            const fileContent = await fs.promises.readFile(config.envFile, "utf-8");
            envFromFile = dotenv.parse(fileContent);
        } catch (err: any) {
            throw new Error(`Failed to read env file ${config.envFile}: ${err.message}`);
        }
    }

    return {
        ...envFromFile,
        ...(config.environment || {}),
    };
}

/**
 * Maps resource config into protobuf ComputerResourceConfig format.
 */
export function buildResourceConfig(
    config: RemoteComputerUseToolProviderConfig
): { cpu?: string; memory?: string } | undefined {
    if (!config.resources) {
        return undefined;
    }
    const result: { cpu?: string; memory?: string } = {};
    if (config.resources.cpu !== undefined) {
        result.cpu = String(config.resources.cpu);
    }
    if (config.resources.memory !== undefined) {
        result.memory = config.resources.memory;
    }
    return result;
}

export class RemoteComputerUseToolProvider extends ComputerUseToolProvider {
    transport: Transport | null = null;
    config: RemoteComputerUseToolProviderConfig;
    computerProviderService: Client<typeof ComputerProviderService> | null = null;
    basicComputerService: Client<typeof BasicComputerService> | null = null;
    graphicalComputerService: Client<typeof GraphicalComputerService> | null = null;
    computerId: string = "";

    constructor(config: RemoteComputerUseToolProviderConfig) {
        super();
        this.config = config;
    }

    async createTools(): Promise<Tool[]> {
        const transportOptions = await buildTransportOptions(this.config);
        this.transport = createConnectTransport(transportOptions);

        this.computerProviderService = createClient(ComputerProviderService, this.transport);
        this.basicComputerService = createClient(BasicComputerService, this.transport);

        const environment = await resolveEnvironmentConfig(this.config);
        const resources = buildResourceConfig(this.config);

        // create the computer
        const createResponse = await this.computerProviderService.createComputer({
            image: this.config.image,
            resources,
            environment,
        });

        switch (createResponse.result.case) {
            case "errorMessage":
                throw new Error(createResponse.result.value);
            case "sessionId":
                this.computerId = createResponse.result.value;
                break;
        }

        // get information about the computer
        const infoResponse = await this.computerProviderService.getComputerInfo({
            sessionId: this.computerId,
        });

        let isGraphical = false;
        switch (infoResponse.type) {
            case ComputerType.UNSPECIFIED:
                throw new Error("Computer does not exist.. this was not supposed to happen");
            case ComputerType.GRAPHICAL:
                isGraphical = true;
                this.graphicalComputerService = createClient(GraphicalComputerService, this.transport);
                break;
            case ComputerType.HEADLESS:
                isGraphical = false;
                break;
        }

        const remoteComputer = new ConnectRemoteComputer(
            this.computerId,
            this.basicComputerService,
            this.graphicalComputerService || undefined
        );

        return buildComputerTools(remoteComputer, isGraphical);
    }
}

