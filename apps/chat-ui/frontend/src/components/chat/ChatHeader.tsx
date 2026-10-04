import { Clock, Zap } from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import type { Interaction } from "@/types";

export interface ChatHeaderProps {
    interaction: Interaction;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ interaction }) => {
    const isInteractive = interaction.mode === "interactive";

    return (
        <header className="px-6 py-3 border-b border-slate-800/80 bg-slate-950/40 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div>
                <h2 className="text-base font-semibold text-slate-100">
                    {interaction.title || `Interaction ${interaction.id}`}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                    <Badge
                        variant={
                            isInteractive ? "interactive" : "nonInteractive"
                        }
                        className="text-[10px] uppercase font-semibold gap-1"
                    >
                        {isInteractive ? (
                            <>
                                <Zap size={11} /> Interactive Mode
                            </>
                        ) : (
                            <>
                                <Clock size={11} /> Non-Interactive (Read-Only)
                            </>
                        )}
                    </Badge>
                    <span className="text-[11px] font-mono text-slate-500">
                        ID: {interaction.id}
                    </span>
                </div>
            </div>
        </header>
    );
};
