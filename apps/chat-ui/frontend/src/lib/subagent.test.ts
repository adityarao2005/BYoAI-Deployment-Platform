import { describe, expect, it } from "bun:test";
import type { SubAgentTask } from "@/types";
import { attachChildSubAgent, updateSubAgentTree } from "./subagent";

describe("subagent tree utilities", () => {
    it("updates a top-level subagent in tree", () => {
        const tasks: SubAgentTask[] = [
            {
                id: "sa-1",
                parentId: "parent-1",
                goal: "Goal 1",
                status: "running",
                messages: [],
                subagents: [],
                startedAt: "2026-10-04T12:00:00Z",
            },
        ];

        const { updated, tasks: newTasks } = updateSubAgentTree(
            tasks,
            "sa-1",
            (t) => ({
                ...t,
                status: "completed",
                result: "Success",
                messages: ["Step 1 complete"],
            }),
        );

        expect(updated).toBe(true);
        expect(newTasks[0]?.status).toBe("completed");
        expect(newTasks[0]?.result).toBe("Success");
        expect(newTasks[0]?.messages).toEqual(["Step 1 complete"]);
    });

    it("updates a nested recursive subagent in tree", () => {
        const tasks: SubAgentTask[] = [
            {
                id: "sa-1",
                parentId: "parent-1",
                goal: "Goal 1",
                status: "running",
                messages: [],
                subagents: [
                    {
                        id: "sa-1-1",
                        parentId: "sa-1",
                        goal: "Sub-goal 1-1",
                        status: "running",
                        messages: [],
                        subagents: [],
                        startedAt: "2026-10-04T12:01:00Z",
                    },
                ],
                startedAt: "2026-10-04T12:00:00Z",
            },
        ];

        const { updated, tasks: newTasks } = updateSubAgentTree(
            tasks,
            "sa-1-1",
            (t) => ({
                ...t,
                status: "completed",
                result: "Nested success",
            }),
        );

        expect(updated).toBe(true);
        expect(newTasks[0]?.subagents[0]?.status).toBe("completed");
        expect(newTasks[0]?.subagents[0]?.result).toBe("Nested success");
    });

    it("attaches a child subagent to parent subagent in tree", () => {
        const tasks: SubAgentTask[] = [
            {
                id: "sa-1",
                parentId: "parent-1",
                goal: "Goal 1",
                status: "running",
                messages: [],
                subagents: [],
                startedAt: "2026-10-04T12:00:00Z",
            },
        ];

        const child: SubAgentTask = {
            id: "sa-1-child",
            parentId: "sa-1",
            goal: "Child Goal",
            status: "running",
            messages: [],
            subagents: [],
            startedAt: "2026-10-04T12:02:00Z",
        };

        const { attached, tasks: newTasks } = attachChildSubAgent(
            tasks,
            "sa-1",
            child,
        );

        expect(attached).toBe(true);
        expect(newTasks[0]?.subagents).toHaveLength(1);
        expect(newTasks[0]?.subagents[0]?.id).toBe("sa-1-child");
    });
});
