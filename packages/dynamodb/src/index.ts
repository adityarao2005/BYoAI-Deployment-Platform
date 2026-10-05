import { randomUUID } from "node:crypto";
import {
    CreateTableCommand,
    DescribeTableCommand,
    DynamoDBClient,
    type DynamoDBClientConfig,
    ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    ScanCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
    AgentMemory,
    type AgentHandle,
    type AgentMemoryManager,
    type AuthContext,
    type ComputerLifecycleManager,
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    type InteractiveMode,
    type UserTokenManager,
    getComputerLifecycleStorageKey,
} from "@byo-ai-agent-platform/core/agents";
import type { ModelInteraction } from "@byo-ai-agent-platform/core/models";

export interface DynamoDBPersistenceProperties {
    endpoint?: string;
    ENDPOINT?: string;
    url?: string;
    URL?: string;
    region?: string;
    REGION?: string;
    accessKeyId?: string;
    ACCESS_KEY_ID?: string;
    secretAccessKey?: string;
    SECRET_ACCESS_KEY?: string;
    sessionToken?: string;
    memoriesTable?: string;
    tokensTable?: string;
    computersTable?: string;
    [key: string]: any;
}

function createDynamoClient(props?: DynamoDBPersistenceProperties): DynamoDBClient {
    const endpoint =
        props?.endpoint ??
        props?.ENDPOINT ??
        props?.url ??
        props?.URL ??
        process.env.DYNAMODB_ENDPOINT ??
        process.env.AWS_ENDPOINT_URL;

    const region =
        props?.region ??
        props?.REGION ??
        process.env.AWS_REGION ??
        process.env.AWS_DEFAULT_REGION ??
        "us-east-1";

    const accessKeyId =
        props?.accessKeyId ??
        props?.ACCESS_KEY_ID ??
        process.env.AWS_ACCESS_KEY_ID ??
        "fakeAccessKeyId";

    const secretAccessKey =
        props?.secretAccessKey ??
        props?.SECRET_ACCESS_KEY ??
        process.env.AWS_SECRET_ACCESS_KEY ??
        "fakeSecretAccessKey";

    const config: DynamoDBClientConfig = {
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken: props?.sessionToken ?? process.env.AWS_SESSION_TOKEN,
        },
    };

    if (endpoint) {
        config.endpoint = endpoint;
    }

    return new DynamoDBClient(config);
}

async function ensureTable(
    client: DynamoDBClient,
    tableName: string,
    pkName: string,
): Promise<void> {
    try {
        await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err: any) {
        if (
            err.name === "ResourceNotFoundException" ||
            err instanceof ResourceNotFoundException ||
            err.__type?.includes("ResourceNotFoundException")
        ) {
            try {
                await client.send(
                    new CreateTableCommand({
                        TableName: tableName,
                        KeySchema: [{ AttributeName: pkName, KeyType: "HASH" }],
                        AttributeDefinitions: [
                            { AttributeName: pkName, AttributeType: "S" },
                        ],
                        BillingMode: "PAY_PER_REQUEST",
                    }),
                );
            } catch (createErr: any) {
                if (createErr.name !== "ResourceInUseException") {
                    throw createErr;
                }
            }
        } else {
            throw err;
        }
    }
}

/**
 * DynamoDB implementation of AgentMemoryManager.
 */
export class DynamoDBAgentMemoryManager implements AgentMemoryManager {
    public readonly client: DynamoDBClient;
    public readonly docClient: DynamoDBDocumentClient;
    public readonly tableName: string;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | DynamoDBPersistenceProperties
            | DynamoDBClient
            | DynamoDBDocumentClient
            | any,
    ) {
        if (props && "send" in props) {
            this.client = props;
            try {
                this.docClient = DynamoDBDocumentClient.from(this.client, {
                    marshallOptions: { removeUndefinedValues: true },
                });
            } catch {
                this.docClient = props as any;
            }
            this.tableName = "byoai_agent_memories";
        } else {
            this.client = createDynamoClient(props);
            this.docClient = DynamoDBDocumentClient.from(this.client, {
                marshallOptions: { removeUndefinedValues: true },
            });
            this.tableName = props?.memoriesTable ?? "byoai_agent_memories";
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = ensureTable(this.client, this.tableName, "id");
        }
        await this.initPromise;
    }

    async createAgentMemoryEntry(
        name: string,
        userId: string,
        mode: InteractiveMode = "interactive",
        parentId?: string,
    ): Promise<string> {
        await this.init();
        const id = randomUUID();
        await this.docClient.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    id,
                    name,
                    userId,
                    mode,
                    parentId: parentId ?? null,
                    transcript: [],
                    createdAt: Date.now(),
                },
            }),
        );
        return id;
    }

    async getAgentMemory(agentId: string): Promise<AgentMemory> {
        await this.init();
        const res = await this.docClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: { id: agentId },
            }),
        );

        if (!res.Item) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const item = res.Item;
        const transcript: ModelInteraction[] = Array.isArray(item.transcript)
            ? item.transcript
            : [];

        return new AgentMemory(
            item.name,
            item.userId,
            transcript,
            item.computerId ?? undefined,
            item.skillsPath ?? undefined,
            item.mode as InteractiveMode,
            item.parentId ?? undefined,
        );
    }

    async addTranscriptEntries(
        agentId: string,
        conversationEntries: ModelInteraction[],
    ): Promise<void> {
        if (conversationEntries.length === 0) return;
        await this.init();

        await this.docClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: { id: agentId },
                UpdateExpression:
                    "SET #transcript = list_append(if_not_exists(#transcript, :empty_list), :new_entries)",
                ExpressionAttributeNames: {
                    "#transcript": "transcript",
                },
                ExpressionAttributeValues: {
                    ":empty_list": [],
                    ":new_entries": conversationEntries,
                },
            }),
        );
    }

    async setComputerId(agentId: string, computerId: string): Promise<void> {
        await this.init();
        await this.docClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: { id: agentId },
                UpdateExpression: "SET computerId = :computerId",
                ExpressionAttributeValues: {
                    ":computerId": computerId,
                },
            }),
        );
    }

    async setSkillsPath(agentId: string, skillsPath: string): Promise<void> {
        await this.init();
        await this.docClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: { id: agentId },
                UpdateExpression: "SET skillsPath = :skillsPath",
                ExpressionAttributeValues: {
                    ":skillsPath": skillsPath,
                },
            }),
        );
    }

    async setName(agentId: string, name: string): Promise<void> {
        await this.init();
        await this.docClient.send(
            new UpdateCommand({
                TableName: this.tableName,
                Key: { id: agentId },
                UpdateExpression: "SET #name = :name",
                ExpressionAttributeNames: {
                    "#name": "name",
                },
                ExpressionAttributeValues: {
                    ":name": name,
                },
            }),
        );
    }

    async getAgent(id: string): Promise<AgentHandle | undefined> {
        await this.init();
        const res = await this.docClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: { id },
            }),
        );

        if (!res.Item) return undefined;
        return {
            id: res.Item.id,
            name: res.Item.name,
            userId: res.Item.userId,
            computerId: res.Item.computerId ?? undefined,
            parentId: res.Item.parentId ?? undefined,
        };
    }

    async getAgentByUser(
        id: string,
        userId: string,
    ): Promise<AgentHandle | undefined> {
        await this.init();
        const agent = await this.getAgent(id);
        if (!agent || agent.userId !== userId) return undefined;
        return agent;
    }

    async getAllAgents(): Promise<string[]> {
        await this.init();
        const res = await this.docClient.send(
            new ScanCommand({
                TableName: this.tableName,
                ProjectionExpression: "id",
            }),
        );
        return (res.Items ?? []).map((item) => item.id);
    }

    async getAllAgentsByUser(userId: string): Promise<string[]> {
        await this.init();
        const res = await this.docClient.send(
            new ScanCommand({
                TableName: this.tableName,
                FilterExpression: "userId = :userId",
                ExpressionAttributeValues: {
                    ":userId": userId,
                },
                ProjectionExpression: "id",
            }),
        );
        return (res.Items ?? []).map((item) => item.id);
    }

    async getSubAgents(parentId: string): Promise<string[]> {
        await this.init();
        const res = await this.docClient.send(
            new ScanCommand({
                TableName: this.tableName,
                FilterExpression: "parentId = :parentId",
                ExpressionAttributeValues: {
                    ":parentId": parentId,
                },
                ProjectionExpression: "id",
            }),
        );
        return (res.Items ?? []).map((item) => item.id);
    }

    async destroy(): Promise<void> {
        this.client.destroy();
    }
}

/**
 * DynamoDB implementation of UserTokenManager.
 */
export class DynamoDBUserTokenManager implements UserTokenManager {
    public readonly client: DynamoDBClient;
    public readonly docClient: DynamoDBDocumentClient;
    public readonly tableName: string;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | DynamoDBPersistenceProperties
            | DynamoDBClient
            | DynamoDBDocumentClient
            | any,
    ) {
        if (props && "send" in props) {
            this.client = props;
            try {
                this.docClient = DynamoDBDocumentClient.from(this.client, {
                    marshallOptions: { removeUndefinedValues: true },
                });
            } catch {
                this.docClient = props as any;
            }
            this.tableName = "byoai_user_tokens";
        } else {
            this.client = createDynamoClient(props);
            this.docClient = DynamoDBDocumentClient.from(this.client, {
                marshallOptions: { removeUndefinedValues: true },
            });
            this.tableName = props?.tokensTable ?? "byoai_user_tokens";
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = ensureTable(this.client, this.tableName, "userId");
        }
        await this.initPromise;
    }

    private getExpirationMs(expiresAt?: number): number | undefined {
        if (expiresAt === undefined) return undefined;
        return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
    }

    async getUserToken(userId: string): Promise<AuthContext | undefined> {
        await this.init();
        const res = await this.docClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: { userId },
            }),
        );

        if (!res.Item) return undefined;

        const expiresAtNum = res.Item.expiresAt
            ? Number(res.Item.expiresAt)
            : undefined;
        const expMs = this.getExpirationMs(expiresAtNum);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return undefined;
        }

        return {
            accessToken: res.Item.accessToken ?? undefined,
            tokenType: res.Item.tokenType ?? undefined,
            expiresAt: expiresAtNum,
            extraHeaders: res.Item.extraHeaders ?? undefined,
        };
    }

    async setUserToken(userId: string, authContext: AuthContext): Promise<void> {
        await this.init();
        const expMs = this.getExpirationMs(authContext.expiresAt);
        if (expMs !== undefined && Date.now() >= expMs) {
            await this.clearUserToken(userId);
            return;
        }

        await this.docClient.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    userId,
                    accessToken: authContext.accessToken ?? null,
                    tokenType: authContext.tokenType ?? null,
                    expiresAt: authContext.expiresAt ?? null,
                    extraHeaders: authContext.extraHeaders ?? null,
                    updatedAt: Date.now(),
                },
            }),
        );
    }

    async clearUserToken(userId: string): Promise<void> {
        await this.init();
        await this.docClient.send(
            new DeleteCommand({
                TableName: this.tableName,
                Key: { userId },
            }),
        );
    }

    async destroy(): Promise<void> {
        this.client.destroy();
    }
}

/**
 * DynamoDB implementation of ComputerLifecycleManager.
 */
export class DynamoDBComputerLifecycleManager implements ComputerLifecycleManager {
    public readonly client: DynamoDBClient;
    public readonly docClient: DynamoDBDocumentClient;
    public readonly tableName: string;
    private initPromise: Promise<void> | null = null;

    constructor(
        props?:
            | DynamoDBPersistenceProperties
            | DynamoDBClient
            | DynamoDBDocumentClient
            | any,
    ) {
        if (props && "send" in props) {
            this.client = props;
            try {
                this.docClient = DynamoDBDocumentClient.from(this.client, {
                    marshallOptions: { removeUndefinedValues: true },
                });
            } catch {
                this.docClient = props as any;
            }
            this.tableName = "byoai_computer_sessions";
        } else {
            this.client = createDynamoClient(props);
            this.docClient = DynamoDBDocumentClient.from(this.client, {
                marshallOptions: { removeUndefinedValues: true },
            });
            this.tableName = props?.computersTable ?? "byoai_computer_sessions";
        }
    }

    async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = ensureTable(this.client, this.tableName, "key");
        }
        await this.initPromise;
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        const res = await this.docClient.send(
            new GetCommand({
                TableName: this.tableName,
                Key: { key },
            }),
        );

        if (!res.Item) return undefined;
        return {
            computerId: res.Item.computerId,
            lifecycle: res.Item.lifecycle,
            skillsPath: res.Item.skillsPath ?? undefined,
            createdAt: res.Item.createdAt ?? undefined,
        };
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.docClient.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    key,
                    computerId: record.computerId,
                    lifecycle: record.lifecycle,
                    skillsPath: record.skillsPath ?? null,
                    createdAt: record.createdAt ?? Date.now(),
                },
            }),
        );
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.init();
        const key = getComputerLifecycleStorageKey(scope);
        await this.docClient.send(
            new DeleteCommand({
                TableName: this.tableName,
                Key: { key },
            }),
        );
    }

    async clear(): Promise<void> {
        await this.init();
        const res = await this.docClient.send(
            new ScanCommand({
                TableName: this.tableName,
                ProjectionExpression: "#k",
                ExpressionAttributeNames: { "#k": "key" },
            }),
        );

        for (const item of res.Items ?? []) {
            await this.docClient.send(
                new DeleteCommand({
                    TableName: this.tableName,
                    Key: { key: item.key },
                }),
            );
        }
    }

    async destroy(): Promise<void> {
        this.client.destroy();
    }
}

// Named exports for all 3 managers
export {
    DynamoDBAgentMemoryManager as AgentMemoryManager,
    DynamoDBAgentMemoryManager as ChatMemory,
    DynamoDBUserTokenManager as UserTokenManager,
    DynamoDBUserTokenManager as TokenStore,
    DynamoDBComputerLifecycleManager as ComputerLifecycleManager,
    DynamoDBComputerLifecycleManager as ComputerStore,
};

// Factory functions
export function createAgentMemoryManager(
    props?: DynamoDBPersistenceProperties,
): DynamoDBAgentMemoryManager {
    return new DynamoDBAgentMemoryManager(props);
}

export function createChatMemory(
    props?: DynamoDBPersistenceProperties,
): DynamoDBAgentMemoryManager {
    return new DynamoDBAgentMemoryManager(props);
}

export function createTokenStore(
    props?: DynamoDBPersistenceProperties,
): DynamoDBUserTokenManager {
    return new DynamoDBUserTokenManager(props);
}

export function createUserTokenManager(
    props?: DynamoDBPersistenceProperties,
): DynamoDBUserTokenManager {
    return new DynamoDBUserTokenManager(props);
}

export function createComputerStore(
    props?: DynamoDBPersistenceProperties,
): DynamoDBComputerLifecycleManager {
    return new DynamoDBComputerLifecycleManager(props);
}

export function createComputerLifecycleManager(
    props?: DynamoDBPersistenceProperties,
): DynamoDBComputerLifecycleManager {
    return new DynamoDBComputerLifecycleManager(props);
}

// Default export
export default DynamoDBAgentMemoryManager;
