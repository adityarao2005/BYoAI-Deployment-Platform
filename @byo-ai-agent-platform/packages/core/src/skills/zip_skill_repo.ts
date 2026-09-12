import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { parse } from "yaml";
import type { Skill, SkillRepository } from "./skills";

export class ZipSkillRepository implements SkillRepository {
    location: string;
    skillsSubdirectory: string;
    headers?: Record<string, string> | undefined;
    skills: Skill[] = [];

    constructor(
        location: string,
        skillsSubdirectory: string = "./",
        headers?: Record<string, string>,
    ) {
        // Initialize the repository with the provided location and optional headers
        // You can implement logic to fetch and manage skills from a zip file here
        this.location = location;
        this.skillsSubdirectory = skillsSubdirectory;
        this.headers = headers;
    }

    async getAllSkills(): Promise<Skill[]> {
        // make sure to fetch everytime
        await this.fetchSkillsFromZip();
        return this.skills;
    }

    async getSkillByName(name: string): Promise<Skill | null> {
        // make sure to fetch everytime
        await this.fetchSkillsFromZip();
        const skill = this.skills.find(
            (skill) => skill.frontMatter.name === name,
        );
        return skill || null;
    }

    async fetchSkillsFromZip(): Promise<void> {
        // Implement logic to fetch skills from the zip file located at this.location

        if (this.location.startsWith("http")) {
            await this.fetchSkillsFromRemoteHttpZip();
        } else {
            await this.fetchSkillsFromLocalZip();
        }
    }

    async fetchSkillsFromLocalZip(): Promise<void> {
        let zipPath = this.location;
        if (!path.isAbsolute(zipPath)) {
            const cwdPath = path.resolve(process.cwd(), zipPath);
            const existsInCwd = await fs.access(cwdPath).then(
                () => true,
                () => false,
            );
            if (!existsInCwd && process.env.AGENT_CONFIG_PATH) {
                const configDirPath = path.resolve(
                    path.dirname(process.env.AGENT_CONFIG_PATH),
                    zipPath,
                );
                if (
                    await fs.access(configDirPath).then(
                        () => true,
                        () => false,
                    )
                ) {
                    zipPath = configDirPath;
                }
            }
        }
        await this.populateSkillsFromZip(zipPath);
    }

    async populateSkillsFromZip(path: string): Promise<void> {
        const zip = new AdmZip(path);
        const normalizedSubdirectory =
            this.skillsSubdirectory === "/"
                ? ""
                : this.skillsSubdirectory.replace(/^\/+|\/+$/g, "");

        this.skills = [];

        for (const entry of zip.getEntries()) {
            if (entry.isDirectory) {
                continue;
            }

            const entryPath = entry.entryName.replace(/^\/+/, "");
            if (!entryPath.endsWith("SKILL.md")) {
                continue;
            }

            if (
                normalizedSubdirectory &&
                !entryPath.startsWith(`${normalizedSubdirectory}/`)
            ) {
                continue;
            }

            const fileContent = entry.getData().toString("utf8");
            const match = fileContent.match(
                /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
            );

            if (!match) {
                throw new Error(`Invalid SKILL.md format in ${entryPath}`);
            }

            const frontMatter = parse(match[1]!) as Skill["frontMatter"];
            this.skills.push({
                frontMatter,
                body: match[2]!,
                // TODO: include target location when computer use feature has been created
            });
        }
    }

    async fetchSkillsFromRemoteHttpZip(): Promise<void> {
        // Implement logic to fetch skills from a remote zip file located at this.location
        const response = await fetch(this.location, {
            method: "GET",
            headers: this.headers ?? {},
        });

        if (!response.ok) {
            throw new Error(
                `Failed to fetch zip file from ${this.location}. Status: ${response.status}. Content: ${await response.text()}`,
            );
        }

        // Create a temporary file to store the downloaded zip
        const filepath = `temp${crypto.randomUUID()}.zip`;

        await using file = await fs.open(filepath, "w");

        // copy the response body to the file
        const writeStream = file.createWriteStream();
        const readable = Readable.fromWeb(response.body as any);
        await pipeline(readable, writeStream);

        try {
            // populate the skills from the zip file
            await this.populateSkillsFromZip(filepath);
        } finally {
            // delete the temporary file
            await fs.rm(filepath);
        }
    }
}
