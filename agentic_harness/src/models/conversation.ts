import { Tool } from "@/tools/tools";

// user and assistant message types
export type Role = 'user' | 'assistant';
export type InteractionType = 'message' | 'tool_call' | 'tool_response';

export type UserMessage = {
    role: Role;
    type: 'message';
    content: string;
}

export type AssistantMessage = {
    role: Role;
    type: 'message';
    content: string;
}

export function isMessage(message: ModelInteraction): message is UserMessage {
    return message.type === 'message';
}

// tool call request and response types
export type ToolCallRequest = {
    type: 'tool_call';
    tool: Tool;
    arguments: Record<string, unknown>;
    id: string;
};

export function isToolCallRequest(message: ModelInteraction): message is ToolCallRequest {
    return message.type === 'tool_call';
}

export type ToolCallResponse = {
    type: 'tool_response';
    result: unknown;
    tool: Tool;
    id: string;
};

export function isToolCallResponse(message: ModelInteraction): message is ToolCallResponse {
    return message.type === 'tool_response';
}

// model message input and output types
export type ModelMessageOutput = AssistantMessage | ToolCallRequest;
export type ModelMessageInput = ToolCallResponse | UserMessage;
export type ModelInteraction = ModelMessageOutput | ModelMessageInput;


// message 
export type ModelInput = {
    history: ModelInteraction[];
    tools: Tool[];
    systemPrompt?: string | undefined;
}

