import { createInterface } from "node:readline/promises";
import { bootstrap } from "./bootstrap";

const { agent, communicator } = await bootstrap();

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
});

while (true) {
    const input = await rl.question(
        "\nEnter a message for the agent (or 'exit' to quit): ",
    );

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
