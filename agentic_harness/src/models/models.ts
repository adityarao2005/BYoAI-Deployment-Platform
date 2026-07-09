import { ModelInput, ModelMessageOutput } from "./conversation";


export interface Model {
    execute(input: ModelInput): Promise<ModelMessageOutput[]>;
}

// a registry for models, which can be used to register and retrieve models by name
export class ModelRegistry {
    private registry: Map<string, Model> = new Map();

    registerModel(key: string, model: Model) {
        this.registry.set(key, model);
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