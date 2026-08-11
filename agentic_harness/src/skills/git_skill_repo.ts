import { execFile } from "node:child_process";
import { mkdtemp, access, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { AgentConfig } from "@/config/config";
import { Skill, SkillRepository, skillRepositoryRegistry } from "./skills";
import { SkillRepositoryConfig } from "@/config/skill_config";

const execFileAsync = promisify(execFile);

type GitRepositoryConfig = Extract<SkillRepositoryConfig, { type: "git" }>;
type GitRepositoryAuth = GitRepositoryConfig["auth"];

export function normalizeSkillsSubdirectory(skillsSubdirectory: string): string {
    const normalized = skillsSubdirectory.replace(/^\/+|\/+$/g, "");

    if (normalized === "" || normalized === ".") {
        return "";
    }

    return normalized;
}

function expandHomeDirectory(filePath: string): string {
    if (filePath === "~") {
        return homedir();
    }

    if (filePath.startsWith("~/")) {
        return join(homedir(), filePath.slice(2));
    }

    return filePath;
}

function escapeForDoubleQuotedShellValue(value: string): string {
    return value.replace(/[\\"$`]/g, "\\$&");
}

function isHttpUrl(location: string): boolean {
    return location.startsWith("http://") || location.startsWith("https://");
}

export function buildGitCloneSource(
    location: string,
    auth?: GitRepositoryAuth,
): { source: string; env: NodeJS.ProcessEnv } {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (auth?.method === "ssh") {
        const privateKeyPath = escapeForDoubleQuotedShellValue(expandHomeDirectory(auth.privateKeyPath));
        env.GIT_SSH_COMMAND = `ssh -i "${privateKeyPath}" -o IdentitiesOnly=yes`;
        return { source: location, env };
    }

    if (auth?.method === "token" && isHttpUrl(location)) {
        const url = new URL(location);
        url.username = "x-access-token";
        url.password = auth.token;
        return { source: url.toString(), env };
    }

    return { source: location, env };
}

async function pathExists(path: string): Promise<boolean> {
    return access(path).then(() => true, () => false);
}

async function findSkillFiles(rootDir: string): Promise<string[]> {
    const skillFiles: string[] = [];

    async function walk(currentDirectory: string) {
        const entries = await readdir(currentDirectory, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === ".git") {
                continue;
            }

            const entryPath = join(currentDirectory, entry.name);

            if (entry.isDirectory()) {
                await walk(entryPath);
                continue;
            }

            if (entry.isFile() && entry.name === "SKILL.md") {
                skillFiles.push(entryPath);
            }
        }
    }

    await walk(rootDir);
    skillFiles.sort((left, right) => left.localeCompare(right));
    return skillFiles;
}

function parseSkillMarkdown(fileContent: string, sourcePath: string): Skill {
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

    if (!match) {
        throw new Error(`Invalid SKILL.md format in ${sourcePath}`);
    }

    const frontMatter = parse(match[1]!) as Skill["frontMatter"];

    return {
        frontMatter,
        body: match[2]!,
    };
}

export class GitSkillRepository implements SkillRepository {
    location: string;
    branch: string;
    skillsSubdirectory: string;
    auth?: GitRepositoryAuth | undefined;
    skills: Skill[] = [];

    constructor(location: string, branch: string = "main", skillsSubdirectory: string = "/", auth?: GitRepositoryAuth) {
        this.location = location;
        this.branch = branch;
        this.skillsSubdirectory = skillsSubdirectory;
        this.auth = auth;
    }

    async getAllSkills(): Promise<Skill[]> {
        await this.fetchSkillsFromGitRepository();
        return this.skills;
    }

    async getSkillByName(name: string): Promise<Skill | null> {
        await this.fetchSkillsFromGitRepository();
        const skill = this.skills.find(currentSkill => currentSkill.frontMatter.name === name);
        return skill ?? null;
    }

    async fetchSkillsFromGitRepository(): Promise<void> {
        const tempDirectory = await mkdtemp(join(tmpdir(), "agent-git-skill-repo-"));

        try {
            const { source, env } = buildGitCloneSource(this.location, this.auth);
            await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", "--branch", this.branch, source, tempDirectory], {
                env,
            });

            await this.populateSkillsFromCheckout(tempDirectory);
        } finally {
            await rm(tempDirectory, { recursive: true, force: true });
        }
    }

    async populateSkillsFromCheckout(checkoutDirectory: string): Promise<void> {
        const normalizedSubdirectory = normalizeSkillsSubdirectory(this.skillsSubdirectory);
        const skillsRoot = normalizedSubdirectory ? resolve(checkoutDirectory, normalizedSubdirectory) : checkoutDirectory;

        this.skills = [];

        if (!(await pathExists(skillsRoot))) {
            return;
        }

        const skillFiles = await findSkillFiles(skillsRoot);

        for (const skillFile of skillFiles) {
            const fileContent = await readFile(skillFile, "utf8");
            this.skills.push(parseSkillMarkdown(fileContent, skillFile));
        }
    }
}

export function registerGitSkillRepositories(config: SkillRepositoryConfig[]) {
    for (const repoConfig of config) {
        if (repoConfig.type === "git") {
            const gitRepo = new GitSkillRepository(repoConfig.url, repoConfig.branch, repoConfig.skillsSubdirectory, repoConfig.auth);
            skillRepositoryRegistry.registerSkillRepository(gitRepo);
        }
    }
}