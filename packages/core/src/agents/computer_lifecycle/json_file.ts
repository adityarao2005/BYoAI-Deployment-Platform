import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    type ComputerLifecycleManager,
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    getComputerLifecycleStorageKey,
} from "../agent.computer_lifecycle";

/**
 * File-backed implementation of {@link ComputerLifecycleManager} that stores
 * computer lifecycle records in JSON files.
 */
export class JsonFileComputerLifecycleManager
    implements ComputerLifecycleManager
{
    private storageDir: string;
    private initialized = false;

    constructor(storageDir?: string) {
        this.storageDir =
            storageDir ?? path.resolve(process.cwd(), ".agent_computers");
    }

    private async ensureStorageDir(): Promise<void> {
        if (!this.initialized) {
            await fs.mkdir(this.storageDir, { recursive: true });
            this.initialized = true;
        }
    }

    private getFilePath(key: string): string {
        // Encode key to safe filename (replace colon and illegal path characters)
        const safeKey = encodeURIComponent(key);
        return path.join(this.storageDir, `${safeKey}.json`);
    }

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        await this.ensureStorageDir();
        const key = getComputerLifecycleStorageKey(scope);
        const filePath = this.getFilePath(key);
        try {
            const data = await fs.readFile(filePath, "utf-8");
            return JSON.parse(data) as ComputerSessionRecord;
        } catch {
            return undefined;
        }
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        await this.ensureStorageDir();
        const key = getComputerLifecycleStorageKey(scope);
        const filePath = this.getFilePath(key);
        const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(record, null, 2), "utf-8");
        await fs.rename(tempPath, filePath);
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        await this.ensureStorageDir();
        const key = getComputerLifecycleStorageKey(scope);
        const filePath = this.getFilePath(key);
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if file doesn't exist
        }
    }

    async clear(): Promise<void> {
        await this.ensureStorageDir();
        try {
            const files = await fs.readdir(this.storageDir);
            for (const file of files) {
                if (file.endsWith(".json")) {
                    await fs.unlink(path.join(this.storageDir, file));
                }
            }
        } catch {
            // Directory might not exist or already empty
        }
    }
}
