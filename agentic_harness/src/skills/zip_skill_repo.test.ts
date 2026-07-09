import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZipSkillRepository } from "./zip_skill_repo";

describe("ZipSkillRepository", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
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

    it("loads all SKILL.md files when the skills subdirectory is the zip root", async () => {
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

        const repository = new ZipSkillRepository(zipPath, "/");
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(2);
        expect(skills.map(skill => skill.frontMatter.name).sort()).toEqual(["nested-skill", "root-skill"]);
    });

    it("filters skills to the configured subdirectory", async () => {
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
            "nested/other.txt": "ignored",
        });

        const repository = new ZipSkillRepository(zipPath, "nested");
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontMatter.name).toBe("nested-skill");
        expect(skills[0]?.body.trim()).toBe("Nested body");


        const repository2 = new ZipSkillRepository(zipPath, "/nested");
        const skills2 = await repository2.getAllSkills();

        expect(skills2).toHaveLength(1);
        expect(skills2[0]?.frontMatter.name).toBe("nested-skill");
        expect(skills2[0]?.body.trim()).toBe("Nested body");
    });
});