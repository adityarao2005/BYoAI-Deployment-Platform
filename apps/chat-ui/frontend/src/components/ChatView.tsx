import { AlertCircle, Loader2, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ChatMessage, Interaction } from "@/types";
import { ChatHeader, ChatInput, ChatMessageItem, EmptyChatState } from "./chat";

interface ChatViewProps {
    interaction: Interaction | null;
    messages: ChatMessage[];
    isAgentRunning: boolean;
    errorMessage?: string | null;
    onDismissError?: () => void;
    onSendMessage: (content: string) => void;
    onToolDecision?: (toolCallId: string, action: "accept" | "reject") => void;
    onNewChat?: (mode: "interactive" | "non-interactive") => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
    interaction,
    messages,
    isAgentRunning,
    errorMessage,
    onDismissError,
    onSendMessage,
    onToolDecision,
    onNewChat,
}) => {
    const [inputText, setInputText] = useState("");

    if (!interaction) {
        return <EmptyChatState onNewChat={onNewChat} />;
    }

    const isInteractive = interaction.mode === "interactive";
    const isInputDisabled = !isInteractive || isAgentRunning;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputText.trim() || isInputDisabled) return;
        onSendMessage(inputText.trim());
        setInputText("");
    };

    return (
        <main className="flex-1 flex flex-col h-full bg-slate-950/20 overflow-hidden">
            <ChatHeader interaction={interaction} />

            {/* Global Error Banner */}
            {errorMessage && (
                <div className="bg-rose-950/80 border-b border-rose-800/80 px-6 py-2.5 flex items-center justify-between text-rose-200 text-xs shrink-0 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <AlertCircle
                            size={14}
                            className="text-rose-400 shrink-0"
                        />
                        <span className="font-medium">{errorMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onDismissError}
                        className="text-rose-400 hover:text-rose-200 cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Messages Scroll View */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                        <p className="text-sm">
                            No messages in this interaction yet.
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                            Send a prompt below to begin the session.
                        </p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <ChatMessageItem
                            key={msg.id}
                            message={msg}
                            onToolDecision={onToolDecision}
                        />
                    ))
                )}

                {/* Live Running Indicator */}
                {isAgentRunning && (
                    <div className="flex items-center gap-2 text-indigo-400 text-xs py-2 px-1">
                        <Loader2 size={13} className="animate-spin" />
                        <span className="font-medium animate-pulse">
                            Agent is executing...
                        </span>
                    </div>
                )}
            </div>

            <ChatInput
                inputText={inputText}
                isInputDisabled={isInputDisabled}
                isInteractive={isInteractive}
                isAgentRunning={isAgentRunning}
                onInputChange={setInputText}
                onSubmit={handleSubmit}
            />
        </main>
    );
};
