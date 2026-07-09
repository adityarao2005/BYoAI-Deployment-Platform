import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

describe("GitSkillRepository", () => {
    let tempDir: string | undefined;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    async function createGitRepo(files: Record<string, string>) {
        tempDir = await mkdtemp(join(tmpdir(), "agent-git-skill-repo-"));
        const repoDir = join(tempDir, "repo");

        await execFileAsync("git", ["init", "-b", "main", repoDir]);

        for (const [filePath, content] of Object.entries(files)) {
            const absolutePath = join(repoDir, filePath);
            await mkdir(dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, content, "utf8");
        }

        await execFileAsync("git", ["-C", repoDir, "add", "."]);
        await execFileAsync("git", ["-C", repoDir, "-c", "user.name=Test User", "-c", "user.email=test@example.com", "commit", "-m", "initial commit"]);

        return repoDir;
    }

    it("loads all SKILL.md files from a git repository root", async () => {
        const repoDir = await createGitRepo({
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

        const { GitSkillRepository } = await import("./git_skill_repo");

        const repository = new GitSkillRepository(repoDir, "main", "/");
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(2);
        expect(skills.map(skill => skill.frontMatter.name).sort()).toEqual(["nested-skill", "root-skill"]);
    });

    it("filters git skills to the configured subdirectory", async () => {
        const repoDir = await createGitRepo({
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

        const { GitSkillRepository } = await import("./git_skill_repo");

        const repository = new GitSkillRepository(repoDir, "main", "nested");
        const skills = await repository.getAllSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0]?.frontMatter.name).toBe("nested-skill");
        expect(skills[0]?.body.trim()).toBe("Nested body");
    });
});