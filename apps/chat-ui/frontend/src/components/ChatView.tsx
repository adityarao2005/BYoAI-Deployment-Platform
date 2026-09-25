import React, { useState } from 'react';
import { Send, Lock, Zap, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { Interaction, ChatMessage } from '@/types';

interface ChatViewProps {
  interaction: Interaction | null;
  messages: ChatMessage[];
  isAgentRunning: boolean;
  onSendMessage: (content: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  interaction,
  messages,
  isAgentRunning,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');

  if (!interaction) {
    return (
      <main className="flex-1 flex items-center justify-center bg-slate-950/20">
        <div className="text-center px-4">
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Welcome to BYoAI Chat</h3>
          <p className="text-sm text-slate-400 max-w-sm mx-auto">
            Select an interaction from the sidebar or create a new session to begin interacting with the AI agents.
          </p>
        </div>
      </main>
    );
  }

  const isInteractive = interaction.mode === 'interactive';
  // Input disabled if non-interactive mode OR if agent is currently executing (awaiting agent:complete)
  const isInputDisabled = !isInteractive || isAgentRunning;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isInputDisabled) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-slate-950/20 overflow-hidden">
      {/* Header */}
      <header className="px-6 py-3 border-b border-slate-800/80 bg-slate-950/40 backdrop-blur-sm flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {interaction.title || `Interaction ${interaction.id}`}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant={isInteractive ? 'interactive' : 'nonInteractive'}
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
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-[80%] ${
                isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  isUser
                    ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm'
                    : 'bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm'
                }`}
              >
                {isUser ? 'U' : 'AI'}
              </div>
              <div className="flex flex-col gap-1">
                <div
                  className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none shadow-sm'
                  }`}
                >
                  <p>{msg.content}</p>
                </div>
                <span
                  className={`text-[11px] text-slate-500 ${
                    isUser ? 'text-right' : 'text-left'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isInputDisabled}
            placeholder={
              !isInteractive
                ? 'Non-interactive prompt is read-only'
                : isAgentRunning
                ? 'Agent is thinking... waiting for completion'
                : 'Type a message to the agent...'
            }
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={isInputDisabled || !inputText.trim()}
            size="icon"
          >
            {isInputDisabled ? <Lock size={15} /> : <Send size={15} />}
          </Button>
        </form>

        {isAgentRunning && (
          <div className="flex items-center gap-2 mt-2 text-xs text-amber-400">
            <Loader2 size={13} className="animate-spin" />
            <span>Agent running... Input is locked until <code>agent:complete</code></span>
          </div>
        )}
      </div>
    </main>
  );
};
