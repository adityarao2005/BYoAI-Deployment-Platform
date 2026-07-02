
import { Skill, SkillRepository, skillRepositoryRegistry } from "./skills";
import { AgentConfig } from "@/config/config";
import fs from "fs/promises"
import { Readable } from "stream";
import { pipeline } from "stream/promises";

class ZipSkillRepository implements SkillRepository {
    location: string;
    skillsSubdirectory: string;
    headers?: Record<string, string> | undefined;
    skills: Skill[] = [];


    constructor(location: string, skillsSubdirectory: string = "./", headers?: Record<string, string>) {
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
        const skill = this.skills.find(skill => skill.frontMatter.name === name);
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
        await this.populateSkillsFromZip(this.location);
    }

    async populateSkillsFromZip(path: string): Promise<void> {
        // TODO: handle zip logic
    }

    async fetchSkillsFromRemoteHttpZip(): Promise<void> {
        // Implement logic to fetch skills from a remote zip file located at this.location
        const response = await fetch(this.location, {
            method: "GET",
            headers: this.headers ?? {}
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch zip file from ${this.location}. Status: ${response.status}. Content: ${await response.text()}`);
        }

        // Create a temporary file to store the downloaded zip
        const filepath = "temp" + crypto.randomUUID() + ".zip";

        await using file = await fs.open(filepath, "w");

        // copy the response body to the file
        const writeStream = file.createWriteStream();
        const readable = Readable.fromWeb(response.body as any)
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


export function registerZipSkillRepositories(config: AgentConfig) {
    for (const repoConfig of config.skillRepositories) {
        if (repoConfig.type === "zip") {
            const zipRepo = new ZipSkillRepository(repoConfig.location, repoConfig.skillsSubdirectory, repoConfig.headers);
            skillRepositoryRegistry.registerSkillRepository(zipRepo);
        }
    }
}