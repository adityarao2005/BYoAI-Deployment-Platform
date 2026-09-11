import { bootstrap } from "./bootstrap";
import { createInterface } from "node:readline/promises";

const { agent, communicator } = await bootstrap();

// Subscribe to communicator events to stream agent lifecycle to stdout
communicator.on("agent:message", ({ content }) => {
    console.log(`assistant: ${content}`);
});

communicator.on("tool:call", ({ tool, args }) => {
    console.log(`Tool call: ${tool} with arguments: ${JSON.stringify(args)}`);
});

communicator.on("tool:complete", ({ tool, result }) => {
    console.log(`Tool response: ${tool} with result: ${JSON.stringify(result)}`);
});

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
});

while (true) {
    const input = await rl.question("\nEnter a message for the agent (or 'exit' to quit): ");

    if (input.trim().toLowerCase() === "exit") {
        console.log("Exiting...");
        process.exit(0);
    }

    console.log("<<Processing>>...");

    // Wait until the agent finishes processing this turn
    await new Promise<void>((resolve) => {
        const unsubscribe = communicator.on("agent:complete", () => {
            unsubscribe();
            resolve();
        });
        communicator.emit("user:message", {
            agent,
            content: input,
        });
    });
}