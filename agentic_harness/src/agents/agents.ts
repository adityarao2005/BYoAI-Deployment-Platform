import { Message, Model } from "@/models/models";
import { SkillRepository } from "@/skills/skills";
import { ToolProvider } from "@/tools/tools";

export class Agent {
    private name: string;
    private model: Model;
    private skillRepository: SkillRepository[];
    private toolProviders: ToolProvider[];

    constructor(name: string, model: Model, skillRepository: SkillRepository[], toolProviders: ToolProvider[]) {
        this.name = name;
        this.model = model;
        this.skillRepository = skillRepository;
        this.toolProviders = toolProviders;
    }

    /*
    Performs a task using the agent's skills and tools. This is a placeholder
    implementation and should be expanded to include the actual logic for
    executing tasks based on the agent's capabilities.
    */
    public async performTask(taskDescription: string): Promise<Message> {
        return this.model.execute([{
            role: "user",
            type: "text",
            content: taskDescription
        }])
    }
}