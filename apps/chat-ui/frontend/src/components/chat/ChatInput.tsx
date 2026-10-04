import { Loader2, Lock, Send } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChatInputProps {
    inputText: string;
    isInputDisabled: boolean;
    isInteractive: boolean;
    isAgentRunning: boolean;
    onInputChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
    inputText,
    isInputDisabled,
    isInteractive,
    isAgentRunning,
    onInputChange,
    onSubmit,
}) => {
    return (
        <footer className="p-4 border-t border-slate-800/80 bg-slate-950/40 backdrop-blur-sm shrink-0">
            <form onSubmit={onSubmit} className="flex gap-2 max-w-4xl mx-auto">
                <Input
                    type="text"
                    value={inputText}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={
                        !isInteractive
                            ? "Non-interactive mode: messaging disabled"
                            : isAgentRunning
                              ? "Agent is thinking..."
                              : "Type a message to the agent..."
                    }
                    disabled={isInputDisabled}
                    className="flex-1 bg-slate-900/80 border-slate-700/80 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500"
                />
                <Button
                    type="submit"
                    disabled={isInputDisabled || !inputText.trim()}
                    className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 shadow-lg shadow-indigo-600/20"
                >
                    {isAgentRunning ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : !isInteractive ? (
                        <Lock size={16} />
                    ) : (
                        <Send size={16} />
                    )}
                    <span>Send</span>
                </Button>
            </form>
            <div className="flex justify-between items-center text-[11px] text-slate-500 mt-2 max-w-4xl mx-auto px-1">
                <span>
                    {!isInteractive
                        ? "This session is read-only."
                        : isAgentRunning
                          ? "Execution in progress. Please wait for completion."
                          : "Press Enter to send message."}
                </span>
                <span className="font-mono text-[10px]">
                    Markdown Supported
                </span>
            </div>
        </footer>
    );
};
