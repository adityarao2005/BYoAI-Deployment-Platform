import "./models";
import { createInterface } from "node:readline/promises";
import { Agent, AgentConversation } from "./agents/agents";
import { skillRepositoryRegistry } from "./skills";
import { toolProviderRegistry } from "./tools/tools";

const agent = new Agent("agent",
    skillRepositoryRegistry.getAllSkillRepositories(),
    toolProviderRegistry.getAllToolProviders())

let conversation: AgentConversation = {
    history: [],
}

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
})

while (true) {

    const input = await rl.question("Enter a message for the agent (or 'exit' to quit): ")

    if (input.toLowerCase() === "exit") {
        console.log("Exiting...")
        process.exit(0)
    }

    console.log("<<Processing>>...")

    conversation.history.push({
        role: "user",
        type: "message",
        content: input
    })

    const lengthBefore = conversation.history.length

    const result = await agent.performTask(conversation)

    const diff = result.history.slice(lengthBefore)

    for (const msg of diff) {
        if (msg.type === "message") {
            console.log(`${msg.role}: ${msg.content}`)
        } else if (msg.type === "tool_call") {
            console.log(`Tool call: ${msg.tool.name} with arguments: ${JSON.stringify(msg.arguments)}`)
        } else if (msg.type === "tool_response") {
            console.log(`Tool response: ${msg.tool.name} with result: ${JSON.stringify(msg.result)}`)
        }
    }

    conversation = result
}