import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { exportSkillRepositoryToZip } from "./exporter";
import type { Skill, SkillRepository } from "./skills";
import { ZipSkillRepository } from "./zip_skill_repo";

describe("exportSkillRepositoryToZip", () => {
    it("exports generic SkillRepository to a valid zip Buffer", async () => {
        const mockRepo: SkillRepository = {
            async getAllSkills(): Promise<Skill[]> {
                return [
                    {
                        frontMatter: {
                            name: "test-skill",
                            description: "A test skill for exporter",
                        },
                        body: "Hello from test skill",
                    },
                ];
            },
            async getSkillByName(name: string): Promise<Skill | null> {
                if (name === "test-skill") {
                    return (await this.getAllSkills())[0]!;
                }
                return null;
            },
        };

        const zipBuffer = await exportSkillRepositoryToZip(mockRepo);
        expect(zipBuffer).toBeDefined();
        expect(zipBuffer.length).toBeGreaterThan(0);

        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();
        expect(entries.some((e) => e.entryName.includes("SKILL.md"))).toBe(true);

        const skillEntry = entries.find((e) => e.entryName.includes("SKILL.md"));
        const content = skillEntry?.getData().toString("utf-8");
        expect(content).toContain("test-skill");
        expect(content).toContain("A test skill for exporter");
    });

    it("exports ZipSkillRepository directly from local file", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exporter-test-"));
        const zipPath = path.join(tempDir, "skills.zip");

        try {
            const zip = new AdmZip();
            zip.addFile(
                "my-skill/SKILL.md",
                Buffer.from(
                    "---\nname: my-skill\ndescription: test zip skill\n---\nBody content",
                ),
            );
            await zip.writeZipPromise(zipPath);

            const repo = new ZipSkillRepository(zipPath);
            const buffer = await exportSkillRepositoryToZip(repo);
            expect(buffer.length).toBeGreaterThan(0);

            const readZip = new AdmZip(buffer);
            expect(readZip.getEntries()).toHaveLength(1);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
