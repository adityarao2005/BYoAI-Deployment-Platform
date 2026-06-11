
export type Role = 'user' | 'assistant' | 'system';

export interface Message {
    role: Role;
    type: string;
    content: string;
}

export interface Model {
    execute(messages: Message[]): Promise<Message>;
}