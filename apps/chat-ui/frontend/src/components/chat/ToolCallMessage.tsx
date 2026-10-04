import { Check, CheckCircle2, ShieldAlert, Wrench, X } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/types";

export interface ToolCallMessageProps {
    message: ChatMessage;
    onToolDecision?: (toolCallId: string, action: "accept" | "reject") => void;
}

export const ToolCallMessage: React.FC<ToolCallMessageProps> = ({
    message,
    onToolDecision,
}) => {
    const toolCall = message.toolCall;
    const toolName = toolCall?.name || "Tool";
    const requiresApproval = Boolean(
        toolCall?.requires_user_input && toolCall?.decision === "pending",
    );
    const isApproved = toolCall?.decision === "accepted";
    const isRejected = toolCall?.decision === "rejected";

    return (
        <div className="mr-auto max-w-[85%] flex gap-3 items-start my-1.5">
            <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    requiresApproval
                        ? "bg-amber-950 border border-amber-600 text-amber-300"
                        : isRejected
                          ? "bg-rose-950 border border-rose-700 text-rose-300"
                          : "bg-slate-900 border border-slate-700 text-slate-300"
                }`}
            >
                {requiresApproval ? (
                    <ShieldAlert size={16} />
                ) : (
                    <Wrench size={15} />
                )}
            </div>

            <div className="flex flex-col gap-1 w-full max-w-xl">
                <div
                    className={`p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-md border ${
                        requiresApproval
                            ? "bg-slate-900/90 border-amber-600/60 text-slate-200"
                            : isRejected
                              ? "bg-slate-900/80 border-rose-800/60 text-slate-300"
                              : "bg-slate-900/80 border-slate-800 text-slate-200"
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
                        <div className="flex items-center gap-2">
                            <Wrench size={13} className="text-indigo-400" />
                            <span className="font-mono text-xs font-semibold text-indigo-300">
                                {toolName}
                            </span>
                        </div>
                        {requiresApproval && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                                Approval Required
                            </span>
                        )}
                        {isApproved && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 size={11} /> Approved
                            </span>
                        )}
                        {isRejected && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                <X size={11} /> Rejected
                            </span>
                        )}
                    </div>

                    {/* Arguments */}
                    {toolCall?.args &&
                        Object.keys(toolCall.args).length > 0 && (
                            <div className="text-xs">
                                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                                    Arguments:
                                </span>
                                <pre className="mt-1 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 font-mono text-[11px] text-slate-300 overflow-x-auto">
                                    {JSON.stringify(toolCall.args, null, 2)}
                                </pre>
                            </div>
                        )}

                    {/* Interactive Approval Banner */}
                    {requiresApproval && (
                        <div className="mt-3 p-3 rounded-xl bg-amber-950/30 border border-amber-700/60 flex flex-col gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                                <ShieldAlert
                                    size={14}
                                    className="text-amber-400 shrink-0"
                                />
                                <span>User confirmation required</span>
                            </div>
                            <p className="text-xs text-amber-200/80">
                                This tool requires approval before execution. Do
                                you permit this action?
                            </p>
                            <div className="flex gap-2 mt-1">
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        if (toolCall?.id) {
                                            onToolDecision?.(
                                                toolCall.id,
                                                "accept",
                                            );
                                        }
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-xs h-7 px-3 font-medium shadow-sm"
                                >
                                    <Check size={13} />
                                    <span>Accept</span>
                                </Button>
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                        if (toolCall?.id) {
                                            onToolDecision?.(
                                                toolCall.id,
                                                "reject",
                                            );
                                        }
                                    }}
                                    className="bg-rose-600 hover:bg-rose-500 text-white gap-1.5 text-xs h-7 px-3 font-medium shadow-sm"
                                >
                                    <X size={13} />
                                    <span>Reject</span>
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Output / Result */}
                    {toolCall?.result !== undefined && (
                        <div className="mt-3 pt-2 border-t border-slate-800 text-xs">
                            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                                Result:
                            </span>
                            <pre className="mt-1 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-36">
                                {typeof toolCall.result === "string"
                                    ? toolCall.result
                                    : JSON.stringify(toolCall.result, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>

                <span className="text-[11px] text-slate-500 text-left">
                    {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    })}
                </span>
            </div>
        </div>
    );
};
