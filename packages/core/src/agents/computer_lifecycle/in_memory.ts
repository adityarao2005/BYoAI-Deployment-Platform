import {
    type ComputerLifecycleManager,
    type ComputerLifecycleScope,
    type ComputerSessionRecord,
    getComputerLifecycleStorageKey,
} from "../agent.computer_lifecycle";

/**
 * In-memory implementation of {@link ComputerLifecycleManager}.
 */
export class InMemoryComputerLifecycleManager
    implements ComputerLifecycleManager
{
    private computers: Map<string, ComputerSessionRecord> = new Map();

    async getComputer(
        scope: ComputerLifecycleScope,
    ): Promise<ComputerSessionRecord | undefined> {
        const key = getComputerLifecycleStorageKey(scope);
        return this.computers.get(key);
    }

    async setComputer(
        scope: ComputerLifecycleScope,
        record: ComputerSessionRecord,
    ): Promise<void> {
        const key = getComputerLifecycleStorageKey(scope);
        this.computers.set(key, record);
    }

    async removeComputer(scope: ComputerLifecycleScope): Promise<void> {
        const key = getComputerLifecycleStorageKey(scope);
        this.computers.delete(key);
    }

    async clear(): Promise<void> {
        this.computers.clear();
    }
}
