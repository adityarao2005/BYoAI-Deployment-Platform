import React from 'react';
import { Plus, MessageSquare, Zap, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Interaction } from '@/types';

interface SidebarProps {
  interactions: Interaction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: (mode: 'interactive' | 'non-interactive') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  interactions,
  selectedId,
  onSelect,
  onNewChat,
}) => {
  return (
    <aside className="w-80 border-r border-slate-800/80 bg-slate-950/40 backdrop-blur-sm flex flex-col h-full">
      <div className="p-3 border-b border-slate-800/80 flex gap-2">
        <Button
          className="flex-1 gap-2 shadow-sm font-medium"
          onClick={() => onNewChat('interactive')}
        >
          <Plus size={16} />
          <span>New Interaction</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {interactions.map((interaction) => {
          const isActive = interaction.id === selectedId;
          const isInteractive = interaction.mode === 'interactive';

          return (
            <button
              type="button"
              key={interaction.id}
              onClick={() => onSelect(interaction.id)}
              className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                isActive
                  ? 'bg-slate-900 border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                  : 'bg-transparent border-transparent hover:bg-slate-900/60 hover:border-slate-800 text-slate-300'
              }`}
            >
              <div className="text-sm font-medium text-slate-100 truncate mb-1.5">
                {interaction.title || `Interaction ${interaction.id.slice(0, 8)}`}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <Badge
                  variant={isInteractive ? 'interactive' : 'nonInteractive'}
                  className="text-[10px] uppercase font-semibold px-2 py-0.5 gap-1"
                >
                  {isInteractive ? (
                    <>
                      <Zap size={10} /> interactive
                    </>
                  ) : (
                    <>
                      <Clock size={10} /> non-interactive
                    </>
                  )}
                </Badge>
                <span className="text-[11px] text-slate-500">
                  {new Date(interaction.updatedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </button>
          );
        })}

        {interactions.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-xs">
            <MessageSquare size={28} className="mx-auto mb-2 opacity-40" />
            <p>No interactions yet.</p>
            <p className="mt-1 text-[11px]">Click &quot;New Interaction&quot; to begin.</p>
          </div>
        )}
      </div>
    </aside>
  );
};
