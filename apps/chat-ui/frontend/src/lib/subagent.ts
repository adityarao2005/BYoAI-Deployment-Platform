import type { SubAgentTask } from "@/types";

/**
 * Recursively updates a SubAgentTask matching `targetId` anywhere in the task tree.
 */
export function updateSubAgentTree(
    tasks: SubAgentTask[],
    targetId: string,
    updater: (task: SubAgentTask) => SubAgentTask,
): { updated: boolean; tasks: SubAgentTask[] } {
    let anyUpdated = false;
    const newTasks = tasks.map((t) => {
        if (t.id === targetId) {
            anyUpdated = true;
            return updater(t);
        }
        if (t.subagents && t.subagents.length > 0) {
            const childRes = updateSubAgentTree(t.subagents, targetId, updater);
            if (childRes.updated) {
                anyUpdated = true;
                return { ...t, subagents: childRes.tasks };
            }
        }
        return t;
    });
    return { updated: anyUpdated, tasks: newTasks };
}

/**
 * Recursively searches for `parentId` in a task tree and attaches `childTask` to its `subagents` list.
 */
export function attachChildSubAgent(
    tasks: SubAgentTask[],
    parentId: string,
    childTask: SubAgentTask,
): { attached: boolean; tasks: SubAgentTask[] } {
    let attached = false;
    const newTasks = tasks.map((t) => {
        if (t.id === parentId) {
            attached = true;
            const existing = (t.subagents || []).some(
                (s) => s.id === childTask.id,
            );
            return existing
                ? t
                : { ...t, subagents: [...(t.subagents || []), childTask] };
        }
        if (t.subagents && t.subagents.length > 0) {
            const childRes = attachChildSubAgent(
                t.subagents,
                parentId,
                childTask,
            );
            if (childRes.attached) {
                attached = true;
                return { ...t, subagents: childRes.tasks };
            }
        }
        return t;
    });
    return { attached, tasks: newTasks };
}
