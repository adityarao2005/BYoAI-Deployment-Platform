import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { skillRepositoryRegistry } from "@byo-ai-agent-platform/core/skills";
import type { AgentConfig } from "@byo-ai-agent-platform/core/config";
import { registerSkillRepositories } from "./bootstrap";

describe("Skill Repository Registration", () => {
    let tempDir: string | undefined;

    beforeEach(() => {
        skillRepositoryRegistry.getAllSkillRepositories().length = 0;
    });

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    async function createZip(files: Record<string, string>) {
        tempDir = await mkdtemp(join(tmpdir(), "agent-zip-skills-"));
        const zipPath = join(tempDir, "skills.zip");
        const zip = new AdmZip();

        for (const [filePath, content] of Object.entries(files)) {
            zip.addFile(filePath, Buffer.from(content, "utf8"));
        }

        zip.writeZip(zipPath);
        return zipPath;
    }

    it("registers zip skill repositories and loads skills", async () => {
        const zipPath = await createZip({
            "SKILL.md": [
                "---",
                "name: root-skill",
                "description: root skill",
                "---",
                "Root body",
            ].join("\n"),
            "nested/SKILL.md": [
                "---",
                "name: nested-skill",
                "description: nested skill",
                "---",
                "Nested body",
            ].join("\n"),
        });

        const config: AgentConfig = {
            models: [],
            skillRepositories: [
                {
                    type: "zip",
                    location: zipPath,
                    skillsSubdirectory: "/",
                },
            ],
            toolProviders: [],
        };

        registerSkillRepositories(config);

        const repos = skillRepositoryRegistry.getAllSkillRepositories();
        expect(repos).toHaveLength(1);

        const skills = await repos[0]!.getAllSkills();
        expect(skills).toHaveLength(2);
        expect(skills.map(s => s.frontMatter.name).sort()).toEqual(["nested-skill", "root-skill"]);
    });

    it("registers git skill repositories from config", () => {
        const config: AgentConfig = {
            models: [],
            skillRepositories: [
                {
                    type: "git",
                    url: "https://github.com/example/skills.git",
                    branch: "main",
                    skillsSubdirectory: "/",
                    auth: {
                        method: "none",
                    },
                },
            ],
            toolProviders: [],
        };

        registerSkillRepositories(config);

        const repos = skillRepositoryRegistry.getAllSkillRepositories();
        expect(repos).toHaveLength(1);
    });
});
