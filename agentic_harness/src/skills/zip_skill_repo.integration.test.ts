import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerZipSkillRepositories", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        vi.resetModules();

        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    async function createZip(files: Record<string, string>) {
        tempDir = await mkdtemp(join(tmpdir(), "agent-zip-skill-repo-"));
        const zipPath = join(tempDir, "skills.zip");
        const zip = new AdmZip();

        for (const [filePath, content] of Object.entries(files)) {
            zip.addFile(filePath, Buffer.from(content, "utf8"));
        }

        zip.writeZip(zipPath);
        return zipPath;
    }

    it("registers zip repositories from config and loads skills from the configured root", async () => {
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

        const { registerZipSkillRepositories } = await import("./zip_skill_repo");
        const { skillRepositoryRegistry } = await import("./skills");

        registerZipSkillRepositories({
            models: [],
            skillRepositories: [
                {
                    type: "zip",
                    location: zipPath,
                    skillsSubdirectory: "/",
                },
            ],
        });

        const repository = skillRepositoryRegistry.getAllSkillRepositories()[0]!;
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(2);
        expect(skills.map(skill => skill.frontMatter.name).sort()).toEqual(["nested-skill", "root-skill"]);
    });

    it("registers only the configured nested subtree from config", async () => {
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

        const { registerZipSkillRepositories } = await import("./zip_skill_repo");
        const { skillRepositoryRegistry } = await import("./skills");

        registerZipSkillRepositories({
            models: [],
            skillRepositories: [
                {
                    type: "zip",
                    location: zipPath,
                    skillsSubdirectory: "nested",
                },
            ],
        });

        const repository = skillRepositoryRegistry.getAllSkillRepositories()[0]!;
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontMatter.name).toBe("nested-skill");
    });
});