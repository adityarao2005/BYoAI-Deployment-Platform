import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { stringify } from "yaml";
import { loadConfig } from "./bootstrap";

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

    it("parses YAML content from an agent.yaml file", async () => {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-config-yaml-"));
        const configPath = join(tempConfigDir, "agent.yaml");

        await writeFile(
            configPath,
            stringify({
                models: [
                    {
                        name: "claude",
                        brand: "anthropic",
                        properties: {
                            apiKey: "sk-ant-123",
                            maxTokens: 4096,
                        },
                    },
                ],
            }),
            "utf8"
        );

        const config = await loadConfig(configPath);

        expect(config.models).toHaveLength(1);
        expect(config.models[0]?.name).toBe("claude");
        expect(config.models[0]?.brand).toBe("anthropic");
    });
});
