import {
    Bot,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Loader2,
    XCircle,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { SubAgentTask } from "@/types";

export interface SubAgentAccordionProps {
    task: SubAgentTask;
    depth?: number;
}

export const SubAgentAccordion: React.FC<SubAgentAccordionProps> = ({
    task,
    depth = 0,
}) => {
    const [isOpen, setIsOpen] = useState(true);
    const isRunning = task.status === "running";
    const isCompleted = task.status === "completed";
    const isError = task.status === "error";

    return (
        <div
            className={`w-full rounded-xl border transition-all ${
                depth > 0
                    ? "mt-2 ml-3 border-slate-800/80 bg-slate-950/40"
                    : "border-indigo-900/40 bg-slate-900/60 shadow-lg"
            }`}
        >
            {/* Header / Accordion Toggle */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/30 rounded-xl transition-colors cursor-pointer group"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="text-slate-400 group-hover:text-slate-200 transition-colors shrink-0">
                        {isOpen ? (
                            <ChevronDown size={15} />
                        ) : (
                            <ChevronRight size={15} />
                        )}
                    </div>
                    <div className="w-5 h-5 rounded-md bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                        <Bot size={12} />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200 truncate">
                                Subagent: {task.goal}
                            </span>
                            {depth > 0 && (
                                <span className="text-[10px] px-1.5 py-0.2 bg-slate-800 text-slate-400 rounded font-mono">
                                    depth {depth}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 truncate">
                            ID: {task.id}
                        </span>
                    </div>
                </div>

                <div className="shrink-0 flex items-center gap-2 ml-2">
                    {isRunning && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                            <Loader2 size={10} className="animate-spin" />{" "}
                            Running
                        </span>
                    )}
                    {isCompleted && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 size={10} /> Completed
                        </span>
                    )}
                    {isError && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
                            <XCircle size={10} /> Error
                        </span>
                    )}
                </div>
            </button>

            {/* Accordion Body */}
            {isOpen && (
                <div className="px-3.5 pb-3 pt-1 border-t border-slate-800/60 flex flex-col gap-2.5">
                    {/* Subagent Messages / Live Output */}
                    {task.messages.length > 0 && (
                        <div className="flex flex-col gap-1.5 mt-1">
                            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                                Progress & Output:
                            </span>
                            {task.messages.map((m) => (
                                <div
                                    key={`${task.id}-msg-${m.slice(0, 20)}`}
                                    className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 font-sans leading-relaxed whitespace-pre-wrap"
                                >
                                    {m}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Subagent Final Result */}
                    {task.result && (
                        <div className="mt-1">
                            <span className="text-[10px] uppercase font-semibold text-emerald-400/90 tracking-wider">
                                Final Result:
                            </span>
                            <div className="mt-1 p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-200/90 whitespace-pre-wrap font-sans">
                                {task.result}
                            </div>
                        </div>
                    )}

                    {/* Subagent Error */}
                    {task.error && (
                        <div className="mt-1">
                            <span className="text-[10px] uppercase font-semibold text-rose-400 tracking-wider">
                                Error:
                            </span>
                            <div className="mt-1 p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/50 text-xs text-rose-200 whitespace-pre-wrap font-sans">
                                {task.error}
                            </div>
                        </div>
                    )}

                    {/* Nested Subagents (Recursion!) */}
                    {task.subagents && task.subagents.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80">
                            <span className="text-[10px] uppercase font-semibold text-indigo-400 tracking-wider flex items-center gap-1 mb-1">
                                <Bot size={11} /> Nested Subagents (
                                {task.subagents.length}):
                            </span>
                            <div className="flex flex-col gap-2">
                                {task.subagents.map((subTask) => (
                                    <SubAgentAccordion
                                        key={subTask.id}
                                        task={subTask}
                                        depth={depth + 1}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
