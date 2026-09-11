import { logger } from "../logger";
import type { Model } from "@/models/models";
import { isToolCallRequest, type ModelInteraction, type ToolCallRequest, type ToolCallResponse } from "@/models/conversation";
import type { Skill, SkillRepository } from "@/skills";
import { loadSkillToolProvider } from "@/tools/load_skill";
import { validateToolArgument } from "@/tools/tool_argument";
import type { Tool, ToolProvider } from "@/tools/tools";
import type { ComputerProvider } from "@/tools";



export type AgentConversation = {
    history: ModelInteraction[];
}

namespace temp {

    // agent type (plain and simple with id)
    export type Agent = {
        id: string
    }

    // memory of agent (computer, transcript of convo and pending tool calls)
    export type AgentMemory = {
        transcript: ModelInteraction[]
        pendingToolCalls: string[]
        computerId?: string
    }

    // memory manager of agent
    export interface AgentMemoryManager {
        // create memory entry of agent
        createAgentMemoryEntry(): Promise<string>
        // grab agent memory
        getAgentMemory(agent: Agent): Promise<AgentMemory>
        // add conversation item
        addTranscriptEntries(agent: Agent, conversationEntries: ModelInteraction[]): Promise<void>
        // sets the computer id for the agent
        setComputerId(agent: Agent, computerId: string): Promise<void>
    }

    // acts as communication agent between executor, tool call, and agent making this truely event driven and asynchronous
    export interface AgentCommunicator {
        // listener listening onto events for when tools results have arrived
        readonly toolCallEventListener: (toolId: string, result: any) => Promise<void>

        // emit tool call event to "handler" (meant to be handled asynchrously, may resume the agent in the same routine too by calling)
        emitToolCallEvent(agent: Agent, toolId: string, tool: string, args: Record<string, any>): Promise<void>

        // emit response to user
        emitUserMessage(agent: Agent, message: string): Promise<void>
    }

    // configuration of the agent
    export type AgentConfiguration = {
        readonly name: string
        readonly description: string
        readonly model: Model
        readonly skillRepository: SkillRepository[]
        readonly toolProviders: ToolProvider[]
        readonly memoryManager: AgentMemoryManager
        readonly communicator: AgentCommunicator
        readonly computerProvider?: ComputerProvider

    }

    // construct system prompt
    function constructSystemPrompt(name: string, description: string, skills: Skill[]) {
        return `
## Who you are:

You are an AI Agent named ${name}.

## Your purpose:

${description}

## Your skills:

<available_skills>
    ${skills.map(skill => `
        <skill>
            <name>${skill.frontMatter.name}</name>
            <description><![CDATA[${skill.frontMatter.description}]]></description>
        </skill>`.trim()
        ).join("\n")}
</available_skills>
        `.trim();
    }

    export interface AgentSession {
        readonly agent: Agent
        readonly name: string
        readonly description: string
        readonly memory: AgentMemory
        readonly skills: Skill[]
        readonly tools: Tool[]
        readonly computerProvider?: ComputerProvider
    }

    // manager of agent
    export class AgentManager {
        private configuration: AgentConfiguration
        private skills: Skill[] = []
        private tools: Tool[] | undefined = undefined

        constructor(configuration: AgentConfiguration) {
            this.configuration = configuration
        }

        async init() {
            // gather all the skills
            this.skills = (await Promise.all(this.configuration.skillRepository.map(repo => repo.getAllSkills())))
                .flat();
        }


        // creates the agent
        async createAgent(): Promise<Agent> {
            // create the agent memory entry
            const id = await this.configuration.memoryManager.createAgentMemoryEntry()

            const agent = {
                id
            }

            // create the computer for the agent
            if (this.configuration.computerProvider) {
                // TODO: when we implement lifecycle management, we'll have a lifecycle manager for this too
                const computerId = await this.configuration.computerProvider.createComputer()
                await this.configuration.memoryManager.setComputerId(agent, computerId)
            }

            return agent
        }

        // creates an agent session which will be used by the tool providers
        private async createAgentSession(agent: Agent): Promise<AgentSession> {
            // grab the memory of the agent
            const memory = await this.configuration.memoryManager.getAgentMemory(agent)

            if (this.tools === undefined) {
                // gather all the tools.. we need to gather only once because we need to know the kind of computer which is being created so we lazy load it
                this.tools = (await Promise.all(
                    // TODO: we'll change this to agent session since we'll need the computer
                    this.configuration.toolProviders.map((provider) => provider.getAllTools(agent))))
                    // flatten the array of arrays into a single array of tools
                    .flat();
            }

            return {
                agent,
                name: this.configuration.name,
                description: this.configuration.description,
                memory,
                skills: this.skills,
                tools: this.tools,
                computerProvider: this.configuration.computerProvider
            }
        }

        // send message to agent
        async sendMessageToAgent(agent: Agent, message: string): Promise<void> {
            const agentSession = this.createAgentSession(agent)


        }


    }

}

export class Agent {
    name: string;
    readonly model: Model;
    readonly skillRepository: SkillRepository[];
    readonly toolProviders: ToolProvider[];
    readonly description: string;
    readonly computerId?: string

    constructor(name: string,
        model: Model,
        skillRepository: SkillRepository[],
        toolProviders: ToolProvider[],
        description: string = "You are a helpful agent.",
        computerId?: string) {
        // set the values
        this.name = name;
        this.model = model;
        this.skillRepository = skillRepository;
        this.toolProviders = toolProviders;
        this.description = description;
        // add the skill tool provider to the agent's tool providers
        this.toolProviders.push(loadSkillToolProvider(this));
        // add the computer id
        this.computerId = computerId
    }

    /*
    Performs a task using the agent's skills and tools. This is a placeholder
    implementation and should be expanded to include the actual logic for
    executing tasks based on the agent's capabilities.
    */
    public async performTask(input: AgentConversation): Promise<AgentConversation> {

        // get the tools
        const tools = (await Promise.all(
            this.toolProviders.map((provider) =>
                provider.getAllTools(this))))
            // flatten the array of arrays into a single array of tools
            .flat();

        // create the model
        const messages: ModelInteraction[] = input.history ? [...input.history] : [];

        do {
            // get the output from the model
            const output = await this.model.execute({
                history: messages,
                systemPrompt: await this.constructSystemPrompt(),
                tools
            });

            logger.info(`Model output: ${JSON.stringify(output)}`);

            // add the output to the messages
            messages.push(...output);

            // check if the output contains a tool call request
            const toolCallRequest = output.filter(isToolCallRequest);

            if (toolCallRequest.length === 0) {
                logger.info("No tool call request found in model output. Ending task execution.");

                break
            }

            logger.info(`Tool call request found: ${JSON.stringify(toolCallRequest)}`);

            // execute the tool call requests
            const toolResponses = await Promise.all(
                toolCallRequest.map(this.executeTool))

            // push all the tool call responses
            messages.push(...toolResponses)

            logger.info(`Tool responses: ${JSON.stringify(toolResponses)}`);
        }
        while (true);

        // set the output to the input, set the history and return
        return {
            history: messages,
        };
    }

    private async executeTool(request: ToolCallRequest): Promise<ToolCallResponse> {
        if (!validateToolArgument(request.tool.inputSchema, request.arguments)) {
            throw new Error(`Invalid arguments for tool ${request.tool.name}`);
        }

        const output = await request.tool.execute(request.arguments, this);

        logger.info(`Tool ${request.tool.name} executed with arguments ${JSON.stringify(request.arguments)}. Output: ${JSON.stringify(output)}`);

        return {
            type: 'tool_response',
            result: output,
            tool: request.tool,
            id: request.id
        };
    }

    private async constructSystemPrompt(): Promise<string> {

        const skills = (await Promise.all(this.skillRepository.map(repo => repo.getAllSkills())))
            .flat();

        return `
## Who you are:

You are an AI Agent named ${this.name}.

## Your purpose:

${this.description}

## Your skills:

<available_skills>
    ${skills.map(skill => `
        <skill>
            <name>${skill.frontMatter.name}</name>
            <description><![CDATA[${skill.frontMatter.description}]]></description>
        </skill>`.trim()
        ).join("\n")}
</available_skills>
        `.trim();
    }
}