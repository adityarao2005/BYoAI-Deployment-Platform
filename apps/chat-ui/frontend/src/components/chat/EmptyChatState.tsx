import { MessageSquarePlus, Plus } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

export interface EmptyChatStateProps {
    onNewChat?: (mode: "interactive" | "non-interactive") => void;
}

export const EmptyChatState: React.FC<EmptyChatStateProps> = ({
    onNewChat,
}) => {
    return (
        <main className="flex-1 flex flex-col items-center justify-center bg-slate-950/20 p-6 text-center">
            <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-2xl backdrop-blur-md flex flex-col items-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4 shadow-inner">
                    <MessageSquarePlus size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-100 mb-2">
                    You have no chats yet
                </h3>
                <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                    Create a new chat session to begin interacting with the AI
                    agent.
                </p>
                <Button
                    onClick={() => onNewChat?.("interactive")}
                    className="w-full gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 shadow-lg shadow-indigo-600/20"
                >
                    <Plus size={18} />
                    <span>Create New Chat</span>
                </Button>
            </div>
        </main>
    );
};
