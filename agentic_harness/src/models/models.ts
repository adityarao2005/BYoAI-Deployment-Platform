import { Tool } from "@/tools/tools";

export type Role = 'user' | 'assistant';

export interface Message {
    role: Role;
    type: string;
    content: string;
}

export type ModelMessageInput = {
    history: Message[];
    tools: Tool[];
    systemPrompt?: string | undefined;
}

export interface Model {
    execute(input: ModelMessageInput): Promise<Message>;
}

// a registry for models, which can be used to register and retrieve models by name
export class ModelRegistry {
    private registry: Map<string, Model> = new Map();

    registerModel(key: string, model: Model) {
        this.registry.set(key, model);
    }

    registerModels(provider: (dict: Record<string, string | undefined>) => Map<string, Model>) {
        provider(process.env).forEach((model, key) => {
            this.registry.set(key, model);
        })
    }

    getModel(key: string): Model | undefined {
        return this.registry.get(key);
    }

    getAllModels(): Map<string, Model> {
        return this.registry;
    }

    // get the default model
    getDefaultModel(): Model | undefined {
        return this.registry.entries().next().value?.[1];
    }
}

export const modelRegistry = new ModelRegistry();