import React, { useState } from 'react';
import {
  Send,
  Lock,
  Zap,
  Clock,
  Loader2,
  AlertCircle,
  MessageSquarePlus,
  Plus,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { Interaction, ChatMessage } from '@/types';

interface ChatViewProps {
  interaction: Interaction | null;
  messages: ChatMessage[];
  isAgentRunning: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
  onSendMessage: (content: string) => void;
  onNewChat?: (mode: 'interactive' | 'non-interactive') => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  interaction,
  messages,
  isAgentRunning,
  errorMessage,
  onDismissError,
  onSendMessage,
  onNewChat,
}) => {
  const [inputText, setInputText] = useState('');

  if (!interaction) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center bg-slate-950/20 p-6 text-center">
        <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-2xl backdrop-blur-md flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4 shadow-inner">
            <MessageSquarePlus size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-100 mb-2">You have no chats yet</h3>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Create a new chat session to begin interacting with the AI agent.
          </p>
          <Button
            onClick={() => onNewChat?.('interactive')}
            className="w-full gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 shadow-lg shadow-indigo-600/20"
          >
            <Plus size={18} />
            <span>Create New Chat</span>
          </Button>
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
          const isError = msg.role === 'error' || msg.isError;

          if (isError) {
            return (
              <div
                key={msg.id}
                className="mr-auto max-w-[85%] flex gap-3 items-start"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 bg-rose-950 border border-rose-700 text-rose-300 shadow-sm">
                  <AlertCircle size={16} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="p-3.5 rounded-2xl rounded-tl-none bg-rose-950/40 border border-rose-800/80 text-rose-200 text-sm leading-relaxed shadow-sm">
                    <div className="flex items-center gap-1.5 font-semibold text-rose-400 text-xs uppercase tracking-wide mb-1">
                      <AlertCircle size={13} />
                      <span>Harness Error</span>
                    </div>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <span className="text-[11px] text-rose-400/70 text-left">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          }

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
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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

      {/* Input Area & Error Banner */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex flex-col gap-2">
        {errorMessage && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-950/50 border border-rose-800/80 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="text-rose-400 hover:text-rose-200 transition-colors ml-2"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
        )}

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
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <Loader2 size={13} className="animate-spin" />
            <span>Agent running... Input is locked until <code>agent:complete</code></span>
          </div>
        )}
      </div>
    </main>
  );
};
