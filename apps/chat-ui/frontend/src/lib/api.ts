import type { UserProfile, Interaction } from '@/types';

export interface HarnessInteractionSummary {
  id: string;
}

export interface HarnessInteractionDetail {
  id: string;
  userId: string;
  mode: 'interactive' | 'non-interactive';
  transcript: Array<{
    role?: 'user' | 'assistant' | 'system';
    content?: string;
    type?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    result?: unknown;
    timestamp?: string;
  }>;
}

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchInteractions(): Promise<Interaction[]> {
  try {
    const res = await fetch('/api/interactions');
    if (!res.ok) return [];
    const data: HarnessInteractionSummary[] = await res.json();
    return data.map((item) => ({
      id: item.id,
      title: `Interaction ${item.id}`,
      mode: 'interactive',
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function createInteraction(mode: 'interactive' | 'non-interactive'): Promise<{ id: string } | null> {
  try {
    const res = await fetch('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getInteraction(id: string): Promise<HarnessInteractionDetail | null> {
  try {
    const res = await fetch(`/api/interactions/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendMessage(id: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/interactions/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function subscribeInteractionSSE(
  id: string,
  onEvent: (event: string, data: unknown) => void,
  onError?: (err: Event) => void
): () => void {
  const eventSource = new EventSource(`/api/interactions/${encodeURIComponent(id)}/sse`);

  const eventTypes = [
    'agent:message',
    'tool:call',
    'tool:result',
    'agent:complete',
    'error',
  ];

  for (const evtName of eventTypes) {
    eventSource.addEventListener(evtName, (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data || '{}');
        onEvent(evtName, parsed);
      } catch {
        onEvent(evtName, (event as MessageEvent).data);
      }
    });
  }

  eventSource.onerror = (err) => {
    if (onError) onError(err);
  };

  return () => {
    eventSource.close();
  };
}
