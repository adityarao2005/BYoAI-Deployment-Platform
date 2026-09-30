import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
                security: {
                    jwksUri: "https://example.com",
                    alg: ["RS256"]
                }
            }),
            "utf8",
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
                security: {
                    jwksUri: "https://example.com",
                    alg: ["RS256"]
                }
            }),
            "utf8",
        );

        const config = await loadConfig(configPath);

        expect(config.models).toHaveLength(1);
        expect(config.models[0]?.name).toBe("claude");
        expect(config.models[0]?.brand).toBe("anthropic");
    });

    it("interpolates environment variables into YAML content", async () => {
        process.env.TEST_GEMINI_KEY = "substituted-gemini-key";
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-config-env-"));
        const configPath = join(tempConfigDir, "agent.yaml");

        await writeFile(
            configPath,
            `
models:
  - name: gemini-flash-latest
    brand: gemini
    properties:
      apiKey: "\${TEST_GEMINI_KEY}"
skillRepositories: []
toolProviders: []
security:
    jwksUri: https://example.com
    alg: ['RS256']
`,
            "utf8",
        );

        try {
            const config = await loadConfig(configPath);
            expect(config.models).toHaveLength(1);
            expect(config.models[0]?.properties.apiKey).toBe(
                "substituted-gemini-key",
            );
        } finally {
            delete process.env.TEST_GEMINI_KEY;
        }
    });

    it("supports default values in environment variable syntax", async () => {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-config-default-"));
        const configPath = join(tempConfigDir, "agent.yaml");

        await writeFile(
            configPath,
            `
models:
  - name: gemini-flash-latest
    brand: gemini
    properties:
      apiKey: "\${UNSET_VAR:-fallback-key}"
skillRepositories: []
toolProviders: []
security:
    jwksUri: "https://example.com"
    alg: ["RS256"]
`,
            "utf8",
        );

        const config = await loadConfig(configPath);
        expect(config.models[0]?.properties.apiKey).toBe("fallback-key");
    });

    it("parses rules from agent.yaml and resolves file imports", async () => {
        tempConfigDir = await mkdtemp(join(tmpdir(), "agent-rules-test-"));
        const rulesFilePath = join(tempConfigDir, "rules.txt");
        await writeFile(rulesFilePath, "Imported file rule 1\n# Comment to ignore\nImported file rule 2\n", "utf8");

        const configPath = join(tempConfigDir, "agent.yaml");
        await writeFile(
            configPath,
            `
models:
  - name: test-model
    brand: gemini
    properties:
      apiKey: "test-key"
rules:
  - "Inline rule 1"
  - file: "${rulesFilePath}"
security:
  jwksUri: "https://example.com"
  alg: ["RS256"]
`,
            "utf8",
        );

        const config = await loadConfig(configPath);
        expect(config.rules).toEqual(["Inline rule 1", { file: rulesFilePath }]);

        const { resolveRules } = await import("./bootstrap");
        const resolved = await resolveRules(config.rules ?? [], tempConfigDir);
        expect(resolved).toEqual([
            "Inline rule 1",
            "Imported file rule 1",
            "Imported file rule 2",
        ]);
    });

    it("successfully loads and parses all repository example agent.yaml files", async () => {
        const exampleConfigs = [
            join(__dirname, "../../../examples/compliance-governed-agent/agent.yaml"),
            join(__dirname, "../../../examples/pet-adoption-agent/agent.yaml"),
            join(__dirname, "../../../examples/computer-use-agent-local/agent.yaml"),
            join(__dirname, "../../../examples/docker-computer-use/agent.yaml"),
        ];

        for (const configPath of exampleConfigs) {
            const config = await loadConfig(configPath);
            expect(config.models.length).toBeGreaterThan(0);
            expect(config.toolProviders.length).toBeGreaterThan(0);
        }
    });
});
