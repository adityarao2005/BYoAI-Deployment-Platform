import { AlertCircle } from "lucide-react";
import type React from "react";
import type { ChatMessage } from "@/types";
import { SubAgentAccordion } from "./SubAgentAccordion";
import { ToolCallMessage } from "./ToolCallMessage";

export interface ChatMessageItemProps {
    message: ChatMessage;
    onToolDecision?: (toolCallId: string, action: "accept" | "reject") => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
    message,
    onToolDecision,
}) => {
    // 1. Subagent execution
    if (message.role === "subagent" && message.subagent) {
        return (
            <div className="mr-auto w-full max-w-2xl my-2">
                <SubAgentAccordion task={message.subagent} />
            </div>
        );
    }

    // 2. Tool calls (and approvals)
    if (message.role === "tool" || message.toolCall) {
        return (
            <ToolCallMessage
                message={message}
                onToolDecision={onToolDecision}
            />
        );
    }

    // 3. Error notifications
    if (message.role === "error" || message.isError) {
        return (
            <div className="mr-auto max-w-[85%] flex gap-3 items-start my-1.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 bg-rose-950 border border-rose-700 text-rose-300 shadow-sm">
                    <AlertCircle size={16} />
                </div>
                <div className="flex flex-col gap-1">
                    <div className="p-3.5 rounded-2xl rounded-tl-none bg-rose-950/40 border border-rose-800/80 text-rose-200 text-sm leading-relaxed shadow-sm">
                        <div className="flex items-center gap-1.5 font-semibold text-rose-400 text-xs uppercase tracking-wide mb-1">
                            <AlertCircle size={13} />
                            <span>Harness Error</span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <span className="text-[11px] text-rose-400/70 text-left">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                        })}
                    </span>
                </div>
            </div>
        );
    }

    // 4. Standard User / Assistant text messages
    const isUser = message.role === "user";

    return (
        <div
            className={`flex gap-3 max-w-[80%] my-1.5 ${
                isUser ? "ml-auto flex-row-reverse" : "mr-auto"
            }`}
        >
            <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    isUser
                        ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm"
                        : "bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm"
                }`}
            >
                {isUser ? "U" : "AI"}
            </div>
            <div className="flex flex-col gap-1">
                <div
                    className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                        isUser
                            ? "bg-indigo-600 text-white rounded-tr-none"
                            : "bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none shadow-sm"
                    }`}
                >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
                <span
                    className={`text-[11px] text-slate-500 ${
                        isUser ? "text-right" : "text-left"
                    }`}
                >
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
