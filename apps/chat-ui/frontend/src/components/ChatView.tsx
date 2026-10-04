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
  Wrench,
  ShieldAlert,
  Check,
  X,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { Interaction, ChatMessage, SubAgentTask } from '@/types';

interface SubAgentAccordionProps {
  task: SubAgentTask;
  depth?: number;
}

const SubAgentAccordion: React.FC<SubAgentAccordionProps> = ({ task, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isRunning = task.status === 'running';
  const isCompleted = task.status === 'completed';
  const isError = task.status === 'error';

  return (
    <div
      className={`w-full rounded-xl border transition-all ${
        depth > 0
          ? 'mt-2 ml-3 border-slate-800/80 bg-slate-950/40'
          : 'border-indigo-900/40 bg-slate-900/60 shadow-lg'
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
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
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
              <Loader2 size={10} className="animate-spin" /> Running
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
          {/* Subagent Messages / Reasoning Output */}
          {task.messages.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                Progress & Output:
              </span>
              {task.messages.map((m, idx) => (
                <div
                  key={idx}
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
                <Bot size={11} /> Nested Subagents ({task.subagents.length}):
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

interface ChatViewProps {
  interaction: Interaction | null;
  messages: ChatMessage[];
  isAgentRunning: boolean;
  errorMessage?: string | null;
  onDismissError?: () => void;
  onSendMessage: (content: string) => void;
  onToolDecision?: (toolCallId: string, action: 'accept' | 'reject') => void;
  onNewChat?: (mode: 'interactive' | 'non-interactive') => void;
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

          if (msg.role === 'subagent' && msg.subagent) {
            return (
              <div key={msg.id} className="mr-auto w-full max-w-2xl my-2">
                <SubAgentAccordion task={msg.subagent} />
              </div>
            );
          }

          if (msg.role === 'tool' || msg.toolCall) {
            const toolCall = msg.toolCall;
            const toolName = toolCall?.name || 'Tool';
            const requiresApproval = Boolean(toolCall?.requires_user_input && toolCall?.decision === 'pending');
            const isApproved = toolCall?.decision === 'accepted';
            const isRejected = toolCall?.decision === 'rejected';

            return (
              <div
                key={msg.id}
                className="mr-auto max-w-[85%] flex gap-3 items-start"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  requiresApproval
                    ? 'bg-amber-950 border border-amber-600 text-amber-300'
                    : isRejected
                    ? 'bg-rose-950 border border-rose-700 text-rose-300'
                    : 'bg-slate-900 border border-slate-700 text-slate-300'
                }`}>
                  {requiresApproval ? <ShieldAlert size={16} /> : <Wrench size={15} />}
                </div>

                <div className="flex flex-col gap-1 w-full max-w-xl">
                  <div className={`p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-md border ${
                    requiresApproval
                      ? 'bg-slate-900/90 border-amber-600/60 text-slate-200'
                      : isRejected
                      ? 'bg-slate-900/80 border-rose-800/60 text-slate-300'
                      : 'bg-slate-900/80 border-slate-800 text-slate-200'
                  }`}>
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
                    {toolCall?.args && Object.keys(toolCall.args).length > 0 && (
                      <div className="text-xs">
                        <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Arguments:</span>
                        <pre className="mt-1 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 font-mono text-[11px] text-slate-300 overflow-x-auto">
                          {JSON.stringify(toolCall.args, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Interactive Approval Banner */}
                    {requiresApproval && (
                      <div className="mt-3 p-3 rounded-xl bg-amber-950/30 border border-amber-700/60 flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                          <ShieldAlert size={14} className="text-amber-400 shrink-0" />
                          <span>User confirmation required</span>
                        </div>
                        <p className="text-xs text-amber-200/80">
                          This tool requires approval before execution. Do you permit this action?
                        </p>
                        <div className="flex gap-2 mt-1">
                          <Button
                            size="sm"
                            onClick={() => onToolDecision?.(toolCall!.id!, 'accept')}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-xs h-7 px-3 font-medium shadow-sm"
                          >
                            <Check size={13} />
                            <span>Accept</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onToolDecision?.(toolCall!.id!, 'reject')}
                            className="bg-rose-600 hover:bg-rose-500 text-white gap-1.5 text-xs h-7 px-3 font-medium shadow-sm"
                          >
                            <X size={13} />
                            <span>Reject</span>
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Output */}
                    {toolCall?.result !== undefined && (
                      <div className="mt-3 pt-2 border-t border-slate-800 text-xs">
                        <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Result:</span>
                        <pre className="mt-1 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-36">
                          {typeof toolCall.result === 'string'
                            ? toolCall.result
                            : JSON.stringify(toolCall.result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-500 text-left">
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
