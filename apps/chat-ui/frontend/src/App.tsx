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
  const [user, setUser] = useState<UserProfile>({
    name: 'Dev User',
    email: 'user@example.com',
    isAuthenticated: true,
  });

  const [interactions, setInteractions] = useState<Interaction[]>([
    {
      id: 'int-demo-1',
      title: 'Repository Architecture Analysis',
      mode: 'interactive',
      status: 'idle',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
    },
  ]);

  const [selectedId, setSelectedId] = useState<string | null>('int-demo-1');
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({
    'int-demo-1': [
      {
        id: 'm1',
        role: 'user',
        content: 'Hello! Can you help me inspect the architecture of the BYoAI deployment platform?',
        timestamp: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'I would be happy to help. The platform consists of the Agentic Harness, Computer Controller, API Gateway, Chat UI, and Shell CLI.',
        timestamp: new Date(Date.now() - 1750000).toISOString(),
      },
    ],
  });

  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Load user profile on mount
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u) setUser(u);
    });
  }, []);

  // Load interactions from backend
  useEffect(() => {
    fetchInteractions().then((serverInteractions) => {
      if (serverInteractions.length > 0) {
        setInteractions(serverInteractions);
        setSelectedId(serverInteractions[0].id);
      }
    });
  }, []);

  // Connect SSE for active interaction
  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!selectedId || selectedId.startsWith('int-demo-')) {
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

    // Subscribe to live SSE events
    const unsub = subscribeInteractionSSE(
      selectedId,
      (event, data) => {
        if (event === 'agent:message') {
          const payload = data as { text?: string; content?: string };
          const text = payload?.text || payload?.content || (typeof data === 'string' ? data : JSON.stringify(data));
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
          setIsAgentRunning(true);
        } else if (event === 'agent:complete') {
          setIsAgentRunning(false);
        }
      },
      () => {
        setIsAgentRunning(false);
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
  }, []);

  const handleNewChat = useCallback(async (mode: 'interactive' | 'non-interactive') => {
    const created = await createInteraction(mode);
    const newId = created?.id || `int-${Date.now()}`;
    const newInteraction: Interaction = {
      id: newId,
      title: mode === 'interactive' ? `Interactive Session (${newId.slice(0, 8)})` : `Task (${newId.slice(0, 8)})`,
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

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedId) return;

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

    if (!selectedId.startsWith('int-demo-')) {
      const ok = await sendMessage(selectedId, content);
      if (!ok) {
        setIsAgentRunning(false);
      }
    } else {
      // Demo response simulation for demo mode
      setTimeout(() => {
        const demoReply: ChatMessage = {
          id: `msg-demo-${Date.now()}`,
          role: 'assistant',
          content: `Simulated response: Received "${content}". The agent is working correctly.`,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => ({
          ...prev,
          [selectedId]: [...(prev[selectedId] || []), demoReply],
        }));
        setIsAgentRunning(false);
      }, 1200);
    }
  }, [selectedId]);

  const currentInteraction = interactions.find((i) => i.id === selectedId) || null;
  const currentMessages = selectedId ? messages[selectedId] || [] : [];

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans antialiased">
      <Navbar user={user} />
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
          onSendMessage={handleSendMessage}
        />
      </div>
    </div>
  );
}

export default App;
