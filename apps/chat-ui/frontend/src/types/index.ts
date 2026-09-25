export type InteractionMode = 'interactive' | 'non-interactive';

export type InteractionStatus = 'idle' | 'running' | 'waiting_input' | 'completed' | 'failed';

export interface Interaction {
  id: string;
  title: string;
  mode: InteractionMode;
  status: InteractionStatus;
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCall?: {
    name: string;
    args?: Record<string, unknown>;
    result?: string;
  };
}

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
  isAuthenticated: boolean;
}
