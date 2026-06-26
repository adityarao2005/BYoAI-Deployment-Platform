import { Message, modelRegistry } from "@/models";
import { SkillRepository } from "@/skills/skills";
import { ToolProvider } from "@/tools/tools";

export class Agent {
    private name: string;
    private skillRepository: SkillRepository[];
    private toolProviders: ToolProvider[];

    constructor(name: string, skillRepository: SkillRepository[], toolProviders: ToolProvider[]) {
        this.name = name;
        this.skillRepository = skillRepository;
        this.toolProviders = toolProviders;
    }

    /*
    Performs a task using the agent's skills and tools. This is a placeholder
    implementation and should be expanded to include the actual logic for
    executing tasks based on the agent's capabilities.
    */
    public async performTask(taskDescription: string, history?: Message[]): Promise<Message> {

        const model = modelRegistry.getDefaultModel();

        if (!model) {
            throw new Error("No model registered in the model registry. Cannot perform task.");
        }

        const messages: Message[] = history ? [...history] : [];

        messages.push({
            role: "user",
            type: "text",
            content: taskDescription
        })

        return model.execute({
            history: messages,
            tools: (await Promise.all(this.toolProviders.map(async (provider) => await provider.getAllTools()))).flatMap(e => e)
        });
    }

}