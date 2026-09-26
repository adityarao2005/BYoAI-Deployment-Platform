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
    const data = await res.json();
    const isAuthed = Boolean(data.authenticated ?? data.isAuthenticated);
    return {
      name: data.name || (isAuthed ? 'Authenticated User' : ''),
      email: data.email || '',
      picture: data.picture,
      isAuthenticated: isAuthed,
    };
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

export async function sendMessage(id: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/interactions/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      let errorMsg = `Server error (${res.status})`;
      try {
        const data = await res.json();
        if (data.message) errorMsg = data.message;
        else if (data.error) errorMsg = data.error;
      } catch {
        // use default errorMsg
      }
      return { success: false, error: errorMsg };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error sending message to agent harness' };
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
    'agent:run',
    'agent:complete',
    'agent:error',
    'tool:call',
    'tool:complete',
    'tool:result',
    'user:message',
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
