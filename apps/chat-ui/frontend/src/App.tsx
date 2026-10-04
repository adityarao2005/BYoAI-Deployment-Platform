import { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from '@/components/Navbar';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';
import type { Interaction, ChatMessage, UserProfile, SubAgentTask } from '@/types';
import {
  fetchCurrentUser,
  fetchInteractions,
  createInteraction,
  sendMessage,
  sendToolDecision,
  subscribeInteractionSSE,
} from '@/lib/api';
import { updateSubAgentTree, attachChildSubAgent } from '@/lib/subagent';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningInteractions, setRunningInteractions] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAgentRunning = Boolean(selectedId && runningInteractions[selectedId]);

  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Check auth and load initial interactions list
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const currentUser = await fetchCurrentUser();
        if (!currentUser || !currentUser.isAuthenticated) {
          // Unauthenticated -> redirect to sign in
          window.location.href = '/auth/login';
          return;
        }

        if (!isMounted) return;
        setUser(currentUser);

        const serverInteractions = await fetchInteractions();
        if (!isMounted) return;

        setInteractions(serverInteractions);
        if (serverInteractions.length > 0) {
          setSelectedId(serverInteractions[0].id);
        } else {
          setSelectedId(null);
        }
      } catch (err) {
        console.error('Failed to initialize app', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Subscribe to real-time SSE stream for active interaction
  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!selectedId) {
      return;
    }

    // Initialize messages bucket if needed
    setMessages((prev) => {
      if (prev[selectedId]) return prev;
      return { ...prev, [selectedId]: [] };
    });

    // Pure SSE streaming from backend
    const unsub = subscribeInteractionSSE(
      selectedId,
      (event, data) => {
        const payload = data as {
          agentId?: string;
          content?: string;
          text?: string;
          error?: string;
          message?: string;
          context?: string;
        };
        const eventAgentId = payload?.agentId || selectedId;

        if (event === 'user:message') {
          const text = payload?.content || payload?.text || (typeof data === 'string' ? data : '');
          if (text) {
            setMessages((prev) => {
              const current = prev[eventAgentId] || [];
              const exists = current.some((m) => m.role === 'user' && m.content === text);
              if (exists) return prev;
              return {
                ...prev,
                [eventAgentId]: [
                  ...current,
                  {
                    id: `msg-u-${Date.now()}-${Math.random()}`,
                    role: 'user',
                    content: text,
                    timestamp: new Date().toISOString(),
                  },
                ],
              };
            });
          }
        } else if (event === 'agent:message') {
          const text = payload?.content || payload?.text || (typeof data === 'string' ? data : '');
          if (text) {
            setMessages((prev) => {
              const current = prev[eventAgentId] || [];
              const exists = current.some((m) => m.role === 'assistant' && m.content === text);
              if (exists) return prev;
              return {
                ...prev,
                [eventAgentId]: [
                  ...current,
                  {
                    id: `msg-ai-${Date.now()}-${Math.random()}`,
                    role: 'assistant',
                    content: text,
                    timestamp: new Date().toISOString(),
                  },
                ],
              };
            });
            setErrorMessage(null);
          }
        } else if (event === 'agent:run') {
          setRunningInteractions((prev) => ({
            ...prev,
            [eventAgentId]: true,
          }));
        } else if (event === 'agent:complete') {
          setRunningInteractions((prev) => ({
            ...prev,
            [eventAgentId]: false,
          }));
        } else if (event === 'tool:call') {
          const tcPayload = data as {
            agentId?: string;
            toolCallId?: string;
            tool?: string;
            args?: Record<string, unknown>;
          };
          const toolCallId = tcPayload?.toolCallId || `tc-${Date.now()}`;
          const toolName = tcPayload?.tool || 'tool';
          const args = tcPayload?.args;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const exists = current.some((m) => m.toolCall?.id === toolCallId);
            if (exists) return prev;
            return {
              ...prev,
              [eventAgentId]: [
                ...current,
                {
                  id: `msg-tool-${toolCallId}`,
                  role: 'tool',
                  content: `Tool: ${toolName}`,
                  timestamp: new Date().toISOString(),
                  toolCall: {
                    id: toolCallId,
                    name: toolName,
                    args,
                    decision: 'pending',
                  },
                },
              ],
            };
          });
        } else if (event === 'tool:approval_required') {
          const reqPayload = data as {
            agentId?: string;
            toolCallId?: string;
            tool?: string;
            args?: Record<string, unknown>;
          };
          const toolCallId = reqPayload?.toolCallId;
          const toolName = reqPayload?.tool || 'tool';
          const args = reqPayload?.args;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const idx = current.findIndex((m) => m.toolCall?.id === toolCallId);
            if (idx !== -1) {
              const updated = [...current];
              const existingCall = updated[idx].toolCall!;
              updated[idx] = {
                ...updated[idx],
                toolCall: {
                  ...existingCall,
                  requires_user_input: true,
                  decision: existingCall.decision ?? 'pending',
                },
              };
              return { ...prev, [eventAgentId]: updated };
            }

            return {
              ...prev,
              [eventAgentId]: [
                ...current,
                {
                  id: `msg-tool-${toolCallId}`,
                  role: 'tool',
                  content: `Approval Required: ${toolName}`,
                  timestamp: new Date().toISOString(),
                  toolCall: {
                    id: toolCallId,
                    name: toolName,
                    args,
                    requires_user_input: true,
                    decision: 'pending',
                  },
                },
              ],
            };
          });
        } else if (event === 'tool:complete') {
          const compPayload = data as {
            agentId?: string;
            toolCallId?: string;
            tool?: string;
            result?: unknown;
          };
          const toolCallId = compPayload?.toolCallId;
          const result = compPayload?.result;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const idx = current.findIndex((m) => m.toolCall?.id === toolCallId);
            if (idx !== -1) {
              const updated = [...current];
              const existingCall = updated[idx].toolCall!;
              const isRejected = Boolean(
                result &&
                  typeof result === 'object' &&
                  'rejected' in result &&
                  (result as { rejected: boolean }).rejected
              );
              updated[idx] = {
                ...updated[idx],
                toolCall: {
                  ...existingCall,
                  result,
                  decision: isRejected ? 'rejected' : 'accepted',
                },
              };
              return { ...prev, [eventAgentId]: updated };
            }
            return prev;
          });
        } else if (event === 'agent:error') {
          setRunningInteractions((prev) => ({
            ...prev,
            [eventAgentId]: false,
          }));

          const errorText =
            payload?.error ||
            payload?.message ||
            (typeof data === 'string' && data !== '{}' ? data : '');

          if (errorText) {
            const errorMsg: ChatMessage = {
              id: `msg-err-${Date.now()}`,
              role: 'error',
              isError: true,
              content: errorText,
              timestamp: new Date().toISOString(),
            };
            setMessages((prev) => ({
              ...prev,
              [eventAgentId]: [...(prev[eventAgentId] || []), errorMsg],
            }));
            setErrorMessage(errorText);
          }
        } else if (event === 'subagent:start') {
          const saPayload = data as {
            agentId?: string;
            parentId?: string;
            subAgentId?: string;
            goal?: string;
          };
          const subAgentId = saPayload?.subAgentId;
          const parentId = saPayload?.parentId;
          const goal = saPayload?.goal || 'Subagent task';
          if (!subAgentId) return;

          const newSubTask: SubAgentTask = {
            id: subAgentId,
            parentId: parentId || eventAgentId,
            goal,
            status: 'running',
            messages: [],
            subagents: [],
            startedAt: new Date().toISOString(),
          };

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];

            // If it's a child of another subagent (nested recursion)
            if (parentId && parentId !== eventAgentId) {
              let attached = false;
              const updated = current.map((m) => {
                if (m.role === 'subagent' && m.subagent) {
                  const res = attachChildSubAgent([m.subagent], parentId, newSubTask);
                  if (res.attached) {
                    attached = true;
                    return { ...m, subagent: res.tasks[0] };
                  }
                }
                return m;
              });
              if (attached) {
                return { ...prev, [eventAgentId]: updated };
              }
            }

            // Top-level subagent under this interaction
            const exists = current.some((m) => m.subagent?.id === subAgentId);
            if (exists) return prev;

            return {
              ...prev,
              [eventAgentId]: [
                ...current,
                {
                  id: `msg-sa-${subAgentId}`,
                  role: 'subagent',
                  content: goal,
                  timestamp: new Date().toISOString(),
                  subagent: newSubTask,
                },
              ],
            };
          });
        } else if (event === 'subagent:message') {
          const saPayload = data as {
            agentId?: string;
            subAgentId?: string;
            content?: string;
          };
          const subAgentId = saPayload?.subAgentId;
          const text = saPayload?.content;
          if (!subAgentId || !text) return;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const updated = current.map((m) => {
              if (m.role === 'subagent' && m.subagent) {
                const res = updateSubAgentTree([m.subagent], subAgentId, (task) => ({
                  ...task,
                  messages: [...task.messages, text],
                }));
                if (res.updated) {
                  return { ...m, subagent: res.tasks[0] };
                }
              }
              return m;
            });
            return { ...prev, [eventAgentId]: updated };
          });
        } else if (event === 'subagent:complete') {
          const saPayload = data as {
            agentId?: string;
            subAgentId?: string;
            result?: string;
          };
          const subAgentId = saPayload?.subAgentId;
          const result = saPayload?.result;
          if (!subAgentId) return;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const updated = current.map((m) => {
              if (m.role === 'subagent' && m.subagent) {
                const res = updateSubAgentTree([m.subagent], subAgentId, (task) => ({
                  ...task,
                  status: 'completed',
                  result: result ?? task.result,
                }));
                if (res.updated) {
                  return { ...m, subagent: res.tasks[0] };
                }
              }
              return m;
            });
            return { ...prev, [eventAgentId]: updated };
          });
        } else if (event === 'subagent:error') {
          const saPayload = data as {
            agentId?: string;
            subAgentId?: string;
            error?: string;
          };
          const subAgentId = saPayload?.subAgentId;
          const error = saPayload?.error;
          if (!subAgentId) return;

          setMessages((prev) => {
            const current = prev[eventAgentId] || [];
            const updated = current.map((m) => {
              if (m.role === 'subagent' && m.subagent) {
                const res = updateSubAgentTree([m.subagent], subAgentId, (task) => ({
                  ...task,
                  status: 'error',
                  error: error ?? 'Subagent execution error',
                }));
                if (res.updated) {
                  return { ...m, subagent: res.tasks[0] };
                }
              }
              return m;
            });
            return { ...prev, [eventAgentId]: updated };
          });
        }
      },
      (err) => {
        console.debug('SSE stream status event:', err);
      }
    );

    unsubscribeRef.current = unsub;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [selectedId]);

  const handleSelectInteraction = useCallback((id: string) => {
    setSelectedId(id);
    setErrorMessage(null);
  }, []);

  const handleNewChat = useCallback(async (mode: 'interactive' | 'non-interactive') => {
    setErrorMessage(null);
    const created = await createInteraction(mode);
    if (!created?.id) {
      setErrorMessage('Failed to create new interaction session. Please try again.');
      return;
    }
    const newId = created.id;
    const newInteraction: Interaction = {
      id: newId,
      title:
        mode === 'interactive'
          ? `Interactive Session (${newId.slice(0, 8)})`
          : `Task (${newId.slice(0, 8)})`,
      mode,
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setInteractions((prev) => [newInteraction, ...prev]);
    setSelectedId(newId);
    setRunningInteractions((prev) => ({
      ...prev,
      [newId]: false,
    }));
    setMessages((prev) => ({
      ...prev,
      [newId]: [],
    }));
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedId) return;

      setErrorMessage(null);
      setRunningInteractions((prev) => ({
        ...prev,
        [selectedId]: true,
      }));

      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };

      // Optimistically show user message while backend emits it on SSE stream
      setMessages((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] || []), userMsg],
      }));

      sendMessage(selectedId, content).then((result) => {
        if (!result.success) {
          const errorText = result.error || 'Failed to send message to the agent harness.';
          const errMsg: ChatMessage = {
            id: `msg-err-${Date.now()}`,
            role: 'error',
            isError: true,
            content: errorText,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => ({
            ...prev,
            [selectedId]: [...(prev[selectedId] || []), errMsg],
          }));
          setErrorMessage(errorText);
          setRunningInteractions((prev) => ({
            ...prev,
            [selectedId]: false,
          }));
        }
      });
    },
    [selectedId]
  );

  const handleDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const handleToolDecision = useCallback(
    async (toolCallId: string, action: 'accept' | 'reject') => {
      if (!selectedId) return;

      // Optimistically update tool call status in messages
      setMessages((prev) => {
        const current = prev[selectedId] || [];
        const idx = current.findIndex((m) => m.toolCall?.id === toolCallId);
        if (idx !== -1) {
          const updated = [...current];
          const existingCall = updated[idx].toolCall!;
          updated[idx] = {
            ...updated[idx],
            toolCall: {
              ...existingCall,
              decision: action === 'accept' ? 'accepted' : 'rejected',
            },
          };
          return { ...prev, [selectedId]: updated };
        }
        return prev;
      });

      const res = await sendToolDecision(selectedId, toolCallId, action);
      if (!res.success && res.error) {
        setErrorMessage(res.error);
      }
    },
    [selectedId]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span className="text-sm text-slate-400">Loading BYoAI Chat...</span>
        </div>
      </div>
    );
  }

  const currentInteraction = interactions.find((i) => i.id === selectedId) || null;
  const currentMessages = selectedId ? messages[selectedId] || [] : [];

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans antialiased">
      <Navbar user={user || { name: '', email: '', isAuthenticated: false }} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          interactions={interactions}
          selectedId={selectedId}
          onSelect={handleSelectInteraction}
          onNewChat={handleNewChat}
        />
        <ChatView
          interaction={currentInteraction}
          messages={currentMessages}
          isAgentRunning={isAgentRunning}
          errorMessage={errorMessage}
          onDismissError={handleDismissError}
          onSendMessage={handleSendMessage}
          onToolDecision={handleToolDecision}
          onNewChat={handleNewChat}
        />
      </div>
    </div>
  );
}

export default App;
