import { describe, expect, it } from "vitest";
import { buildGitCloneSource, normalizeSkillsSubdirectory } from "./git_skill_repo";

describe("git skill repository helpers", () => {
    it("normalizes root subdirectories", () => {
        expect(normalizeSkillsSubdirectory("/")).toBe("");
        expect(normalizeSkillsSubdirectory("./")).toBe("");
        expect(normalizeSkillsSubdirectory("nested/")).toBe("nested");
        expect(normalizeSkillsSubdirectory("/nested")).toBe("nested");
    });

    it("builds an authenticated HTTPS clone source for token auth", () => {
        const { source, env } = buildGitCloneSource("https://example.com/org/repo.git", {
            method: "token",
            token: "secret-token",
        });

        expect(source).toBe("https://x-access-token:secret-token@example.com/org/repo.git");
        expect(env.GIT_SSH_COMMAND).toBeUndefined();
    });

    it("builds an SSH command for key-based auth", () => {
        const { source, env } = buildGitCloneSource("git@example.com:org/repo.git", {
            method: "ssh",
            privateKeyPath: "~/.ssh/id_ed25519",
        });

        expect(source).toBe("git@example.com:org/repo.git");
        expect(env.GIT_SSH_COMMAND).toContain("ssh -i");
        expect(env.GIT_SSH_COMMAND).toContain("-o IdentitiesOnly=yes");
    });
});