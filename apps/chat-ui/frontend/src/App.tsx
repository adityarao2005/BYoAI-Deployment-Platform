import { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';
import type { Interaction, ChatMessage, UserProfile } from '@/types';

export function App() {
  const [user] = useState<UserProfile>({
    name: 'Dev User',
    email: 'user@example.com',
    isAuthenticated: true,
  });

  const [interactions, setInteractions] = useState<Interaction[]>([
    {
      id: 'int-1',
      title: 'Repository Architecture Analysis',
      mode: 'interactive',
      status: 'idle',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      id: 'int-2',
      title: 'Batch Code Review (Non-Interactive)',
      mode: 'non-interactive',
      status: 'completed',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 85000000).toISOString(),
    },
  ]);

  const [selectedId, setSelectedId] = useState<string | null>('int-1');
  const [isAgentRunning] = useState(false);

  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({
    'int-1': [
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
    'int-2': [
      {
        id: 'm3',
        role: 'user',
        content: 'Analyze all security vulnerabilities in the latest release.',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'm4',
        role: 'assistant',
        content: 'Completed scan: zero critical vulnerabilities found across all Go and TypeScript modules.',
        timestamp: new Date(Date.now() - 85000000).toISOString(),
      },
    ],
  });

  const handleSelectInteraction = (id: string) => {
    setSelectedId(id);
  };

  const handleNewChat = (mode: 'interactive' | 'non-interactive') => {
    const newId = `int-${Date.now()}`;
    const newInteraction: Interaction = {
      id: newId,
      title: mode === 'interactive' ? 'New Interactive Session' : 'New Non-Interactive Task',
      mode,
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setInteractions([newInteraction, ...interactions]);
    setSelectedId(newId);
    setMessages({
      ...messages,
      [newId]: [],
    });
  };

  const handleSendMessage = (content: string) => {
    if (!selectedId) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    const currentMsgs = messages[selectedId] || [];
    setMessages({
      ...messages,
      [selectedId]: [...currentMsgs, userMsg],
    });
  };

  const currentInteraction = interactions.find((i) => i.id === selectedId) || null;
  const currentMessages = selectedId ? messages[selectedId] || [] : [];

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden">
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
