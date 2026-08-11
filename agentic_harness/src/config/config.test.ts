import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
    let tempConfigDir: string | undefined;

    afterEach(async () => {
        if (tempConfigDir) {
            await rm(tempConfigDir, { recursive: true, force: true });
            tempConfigDir = undefined;
        }
    });

    it("parses JSON content from an agent.yaml file", async () => {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-config-json-"));
        const configPath = join(tempConfigDir, "agent.yaml");

        await writeFile(
            configPath,
            JSON.stringify({
                models: [
                    {
                        name: "gpt4",
                        brand: "openai",
                        properties: {
                            apiKey: "sk-test-key-123",
                        },
                    },
                ],
            }),
            "utf8"
        );

        const config = await loadConfig(configPath);

        expect(config.models).toHaveLength(1);
        expect(config.models[0]).toMatchObject({
            name: "gpt4",
            brand: "openai",
            properties: {
                apiKey: "sk-test-key-123",
            },
        });
        expect(config.skillRepositories).toEqual([]);
        expect(config.toolProviders).toEqual([]);
    });
});