import { describe, expect, test } from "vitest";
import { SelfHostedModel } from "./self_hosted";

// only describe the tests if the environment variable is set, otherwise skip them
const SELF_HOSTED_MODEL_BASE_URL = process.env.SELF_HOSTED_MODEL_BASE_URL;
if (SELF_HOSTED_MODEL_BASE_URL) {

    describe("SelfHostedModel", () => {

        // test whether it completes a chat completion request successfully, and logs the choices and selected response
        test("should execute a chat completion request", async () => {

            const model = new SelfHostedModel(SELF_HOSTED_MODEL_BASE_URL)

            const message = await model.execute([
                {
                    role: "user",
                    content: "Hello, how are you?",
                    type: "text"
                }
            ])

            expect(message).toBeDefined();
        }, 15_000) // set a longer timeout for this test since it involves network requests
    })
}