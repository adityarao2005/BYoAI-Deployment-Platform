import { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from '@/components/Navbar';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';
import type { Interaction, ChatMessage, UserProfile } from '@/types';
import {
  fetchCurrentUser,
  fetchInteractions,
  createInteraction,
  getInteraction,
  sendMessage,
  subscribeInteractionSSE,
} from '@/lib/api';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Check auth and load initial interactions
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

  // Connect SSE for active interaction
  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!selectedId) {
      return;
    }

    // Fetch existing transcript
    getInteraction(selectedId).then((detail) => {
      if (detail && detail.transcript) {
        const parsedMsgs: ChatMessage[] = detail.transcript
          .filter((t) => t.role === 'user' || t.role === 'assistant')
          .map((t, idx) => ({
            id: `msg-${idx}-${Date.now()}`,
            role: (t.role || 'assistant') as 'user' | 'assistant',
            content: t.content || '',
            timestamp: t.timestamp || new Date().toISOString(),
          }));

        setMessages((prev) => ({
          ...prev,
          [selectedId]: parsedMsgs,
        }));
      }
    });

    // Subscribe to live SSE events from harness
    const unsub = subscribeInteractionSSE(
      selectedId,
      (event, data) => {
        if (event === 'agent:message') {
          const payload = data as { content?: string; text?: string };
          const text =
            payload?.content ||
            payload?.text ||
            (typeof data === 'string' ? data : '');
          if (text) {
            const aiMsg: ChatMessage = {
              id: `msg-ai-${Date.now()}`,
              role: 'assistant',
              content: text,
              timestamp: new Date().toISOString(),
            };
            setMessages((prev) => ({
              ...prev,
              [selectedId]: [...(prev[selectedId] || []), aiMsg],
            }));
            setErrorMessage(null);
          }
          setIsAgentRunning(false);
        } else if (event === 'agent:error') {
          const payload = data as { error?: string; message?: string; context?: string };
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
              [selectedId]: [...(prev[selectedId] || []), errorMsg],
            }));
            setErrorMessage(errorText);
          }
          setIsAgentRunning(false);
        } else if (event === 'agent:complete') {
          setIsAgentRunning(false);
        }
      },
      (err) => {
        // SSE transport errors/reconnections should not inject fake harness errors
        console.debug('SSE transport event:', err);
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
    setIsAgentRunning(false);
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
    setMessages((prev) => ({
      ...prev,
      [newId]: [],
    }));
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedId) return;

      setErrorMessage(null);
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] || []), userMsg],
      }));

      setIsAgentRunning(true);

      const result = await sendMessage(selectedId, content);
      if (!result.success) {
        setIsAgentRunning(false);
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
      }
    },
    [selectedId]
  );

  const handleDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

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
          onNewChat={handleNewChat}
        />
      </div>
    </div>
  );
}

export default App;
