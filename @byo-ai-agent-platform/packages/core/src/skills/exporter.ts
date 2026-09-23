import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { GitSkillRepository, buildGitCloneSource } from "./git_skill_repo";
import { getSkillMDFile, type SkillRepository } from "./skills";
import { ZipSkillRepository } from "./zip_skill_repo";

const execFileAsync = promisify(execFile);

/**
 * Exports all skills and assets from a given SkillRepository into a single ZIP Buffer.
 */
export async function exportSkillRepositoryToZip(
    repo: SkillRepository,
): Promise<Buffer> {
    if (repo instanceof ZipSkillRepository) {
        return exportZipSkillRepository(repo);
    }

    if (repo instanceof GitSkillRepository) {
        return exportGitSkillRepository(repo);
    }

    return exportGenericSkillRepository(repo);
}

async function exportZipSkillRepository(
    repo: ZipSkillRepository,
): Promise<Buffer> {
    if (repo.location.startsWith("http://") || repo.location.startsWith("https://")) {
        const response = await fetch(repo.location, {
            method: "GET",
            headers: repo.headers ?? {},
        });
        if (!response.ok) {
            throw new Error(
                `Failed to fetch zip from ${repo.location}. Status: ${response.status}`,
            );
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    let zipPath = repo.location;
    if (!path.isAbsolute(zipPath)) {
        const cwdPath = path.resolve(process.cwd(), zipPath);
        const existsInCwd = await fs
            .access(cwdPath)
            .then(
                () => true,
                () => false,
            );
        if (!existsInCwd && process.env.AGENT_CONFIG_PATH) {
            const configDirPath = path.resolve(
                path.dirname(process.env.AGENT_CONFIG_PATH),
                zipPath,
            );
            if (
                await fs
                    .access(configDirPath)
                    .then(
                        () => true,
                        () => false,
                    )
            ) {
                zipPath = configDirPath;
            }
        }
    }
    return fs.readFile(zipPath);
}

async function exportGitSkillRepository(
    repo: GitSkillRepository,
): Promise<Buffer> {
    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "agent-git-export-"),
    );

    try {
        const { source, env } = buildGitCloneSource(repo.location, repo.auth);

        await execFileAsync(
            "git",
            [
                "clone",
                "--depth",
                "1",
                "--single-branch",
                "--branch",
                repo.branch,
                source,
                tempDir,
            ],
            { env: { ...process.env, ...env } },
        );

        // Remove .git directory before zipping
        const gitMetaDir = path.join(tempDir, ".git");
        await fs.rm(gitMetaDir, { recursive: true, force: true });

        // Zip directory
        const zip = new AdmZip();
        zip.addLocalFolder(tempDir);
        return zip.toBuffer();
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function exportGenericSkillRepository(
    repo: SkillRepository,
): Promise<Buffer> {
    const skills = await repo.getAllSkills();
    const zip = new AdmZip();

    for (const skill of skills) {
        const content = getSkillMDFile(skill);
        const skillName = skill.frontMatter.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        zip.addFile(
            `${skillName}/SKILL.md`,
            Buffer.from(content, "utf-8"),
        );
    }

    return zip.toBuffer();
}
