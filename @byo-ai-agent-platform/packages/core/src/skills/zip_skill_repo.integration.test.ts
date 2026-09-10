import AdmZip from "adm-zip";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
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

    async function createZipBuffer(files: Record<string, string>) {
        const zip = new AdmZip();

        for (const [filePath, content] of Object.entries(files)) {
            zip.addFile(filePath, Buffer.from(content, "utf8"));
        }

        return zip.toBuffer();
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

        registerZipSkillRepositories([
            {
                type: "zip",
                location: zipPath,
                skillsSubdirectory: "/",
            },
        ]);

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

        registerZipSkillRepositories([
            {
                type: "zip",
                location: zipPath,
                skillsSubdirectory: "nested",
            },
        ]);

        const repository = skillRepositoryRegistry.getAllSkillRepositories()[0]!;
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontMatter.name).toBe("nested-skill");
    });

    it("fetches and loads skills from an HTTP zip url", async () => {
        const zipBuffer = await createZipBuffer({
            "SKILL.md": [
                "---",
                "name: remote-root-skill",
                "description: remote root skill",
                "---",
                "Remote body",
            ].join("\n"),
            "nested/SKILL.md": [
                "---",
                "name: remote-nested-skill",
                "description: remote nested skill",
                "---",
                "Remote nested body",
            ].join("\n"),
        });

        const server = createServer((request, response) => {
            if (request.url === "/skills") {
                response.writeHead(200, {
                    "content-type": "application/zip",
                    "content-length": String(zipBuffer.length),
                });
                response.end(zipBuffer);
                return;
            }

            response.statusCode = 404;
            response.end("not found");
        });

        server.listen(0);
        await once(server, "listening");

        try {
            const address = server.address();

            if (address === null || typeof address === "string") {
                throw new Error("Failed to start HTTP test server");
            }

            const { registerZipSkillRepositories } = await import("./zip_skill_repo");
            const { skillRepositoryRegistry } = await import("./skills");

            registerZipSkillRepositories([
                {
                    type: "zip",
                    location: `http://127.0.0.1:${address.port}/skills`,
                    skillsSubdirectory: "/",
                },
            ]);

            const repository = skillRepositoryRegistry.getAllSkillRepositories()[0]!;
            const skills = await repository.getAllSkills();

            expect(skills).toHaveLength(2);
            expect(skills.map(skill => skill.frontMatter.name).sort()).toEqual(["remote-nested-skill", "remote-root-skill"]);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});