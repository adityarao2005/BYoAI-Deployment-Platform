import "./models/self_hosted";
import { createInterface } from "node:readline/promises";
import { Agent } from "./agents/agents";
import { Message } from "./models/models";

const agent = new Agent("agent", [], [])

console.log("Agent created: ", agent)

const messages: Message[] = []

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

    const response = await agent.performTask(input, messages)

    console.log(`Agent response: ${response.content}`)

    messages.push({
        role: "user",
        type: "text",
        content: input
    })
    messages.push(response)
}