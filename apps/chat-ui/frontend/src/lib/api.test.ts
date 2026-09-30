import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const vi = { fn: mock };
import {
  fetchCurrentUser,
  fetchInteractions,
  createInteraction,
  sendMessage,
  getInteraction,
  subscribeInteractionSSE,
} from './api';

// ─── Mock fetch for REST API tests ──────────────────────────────────

describe('REST API functions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchCurrentUser', () => {
    it('returns user profile when authenticated', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: true,
          name: 'Test User',
          email: 'test@example.com',
        }),
      });

      const user = await fetchCurrentUser();
      expect(user).toEqual({
        name: 'Test User',
        email: 'test@example.com',
        picture: undefined,
        isAuthenticated: true,
      });
    });

    it('returns null when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const user = await fetchCurrentUser();
      expect(user).toBeNull();
    });

    it('returns null when response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
      });
      const user = await fetchCurrentUser();
      expect(user).toBeNull();
    });
  });

  describe('createInteraction', () => {
    it('creates interaction and returns id', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'test-interaction-123' }),
      });

      const result = await createInteraction('interactive');
      expect(result).toEqual({ id: 'test-interaction-123' });
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'interactive' }),
      });
    });

    it('returns null on failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const result = await createInteraction('interactive');
      expect(result).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('sends message and returns success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await sendMessage('interaction-1', 'Hello');
      expect(result).toEqual({ success: true });
    });

    it('returns error on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Bad request' }),
      });

      const result = await sendMessage('interaction-1', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Bad request');
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await sendMessage('interaction-1', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('getInteraction', () => {
    it('returns interaction detail', async () => {
      const mockDetail = {
        id: 'int-1',
        userId: 'user-1',
        mode: 'interactive',
        transcript: [{ role: 'user', content: 'hello', type: 'message' }],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDetail,
      });

      const result = await getInteraction('int-1');
      expect(result).toEqual(mockDetail);
    });

    it('returns null on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await getInteraction('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('fetchInteractions', () => {
    it('returns mapped interactions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'int-1' }, { id: 'int-2' }],
      });

      const result = await fetchInteractions();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('int-1');
      expect(result[1].id).toBe('int-2');
    });

    it('returns empty array on failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const result = await fetchInteractions();
      expect(result).toEqual([]);
    });
  });
});

// ─── SSE subscription tests ─────────────────────────────────────────

describe('subscribeInteractionSSE', () => {
  let mockEventSource: {
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onerror: ((e: Event) => void) | null;
  };
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    mockEventSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      onerror: null,
    };
    (globalThis as any).EventSource = vi.fn().mockImplementation(() => mockEventSource);
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  it('creates EventSource with correct URL', () => {
    subscribeInteractionSSE('my-id', () => {});
    expect(globalThis.EventSource).toHaveBeenCalledWith('/api/interactions/my-id/sse');
  });

  it('registers listeners for all event types', () => {
    subscribeInteractionSSE('my-id', () => {});
    const registeredEvents = mockEventSource.addEventListener.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredEvents).toContain('agent:message');
    expect(registeredEvents).toContain('agent:run');
    expect(registeredEvents).toContain('agent:complete');
    expect(registeredEvents).toContain('agent:error');
    expect(registeredEvents).toContain('tool:call');
    expect(registeredEvents).toContain('tool:complete');
    expect(registeredEvents).toContain('user:message');
  });

  it('parses JSON data and calls onEvent with parsed payload', () => {
    const onEvent = vi.fn();
    subscribeInteractionSSE('my-id', onEvent);

    // Find the agent:message listener
    const agentMessageCall = mockEventSource.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === 'agent:message'
    );
    const listener = agentMessageCall![1] as (event: MessageEvent) => void;

    // Simulate an SSE event
    listener({ data: '{"content":"Hello from agent"}' } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith('agent:message', { content: 'Hello from agent' });
  });

  it('handles non-JSON data gracefully', () => {
    const onEvent = vi.fn();
    subscribeInteractionSSE('my-id', onEvent);

    const agentCompleteCall = mockEventSource.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === 'agent:complete'
    );
    const listener = agentCompleteCall![1] as (event: MessageEvent) => void;

    // Non-JSON data
    listener({ data: 'plain text data' } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith('agent:complete', 'plain text data');
  });

  it('calls onError when EventSource errors', () => {
    const onError = vi.fn();
    subscribeInteractionSSE('my-id', () => {}, onError);

    // Trigger error
    const errorEvent = new Event('error');
    mockEventSource.onerror!(errorEvent);
    expect(onError).toHaveBeenCalledWith(errorEvent);
  });

  it('returns unsubscribe function that closes EventSource', () => {
    const unsub = subscribeInteractionSSE('my-id', () => {});
    unsub();
    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it('delivers events in correct order for a full agent turn', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    const onEvent = (event: string, data: unknown) => {
      events.push({ event, data });
    };
    subscribeInteractionSSE('my-id', onEvent);

    // Simulate a complete turn: agent:run → agent:message → agent:complete
    const getListener = (eventType: string) => {
      const call = mockEventSource.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === eventType
      );
      return call![1] as (event: MessageEvent) => void;
    };

    getListener('agent:run')({ data: '{"agentId":"my-id"}' } as MessageEvent);
    getListener('agent:message')({
      data: '{"agentId":"my-id","content":"Hello!"}',
    } as MessageEvent);
    getListener('agent:complete')({ data: '{"agentId":"my-id"}' } as MessageEvent);

    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('agent:run');
    expect(events[1].event).toBe('agent:message');
    expect((events[1].data as { content: string }).content).toBe('Hello!');
    expect(events[2].event).toBe('agent:complete');
  });

  it('delivers tool call events in correct order', () => {
    const events: Array<{ event: string; data: unknown }> = [];
    subscribeInteractionSSE('my-id', (event, data) => {
      events.push({ event, data });
    });

    const getListener = (eventType: string) => {
      const call = mockEventSource.addEventListener.mock.calls.find(
        (c: unknown[]) => c[0] === eventType
      );
      return call![1] as (event: MessageEvent) => void;
    };

    getListener('agent:run')({ data: '{}' } as MessageEvent);
    getListener('tool:call')({
      data: '{"toolCallId":"tc1","tool":"calculator","args":{"a":5,"b":7}}',
    } as MessageEvent);
    getListener('tool:complete')({
      data: '{"toolCallId":"tc1","tool":"calculator","result":{"sum":12}}',
    } as MessageEvent);
    getListener('agent:run')({ data: '{}' } as MessageEvent);
    getListener('agent:message')({ data: '{"content":"The sum is 12."}' } as MessageEvent);
    getListener('agent:complete')({ data: '{}' } as MessageEvent);

    expect(events).toHaveLength(6);
    expect(events.map((e) => e.event)).toEqual([
      'agent:run',
      'tool:call',
      'tool:complete',
      'agent:run',
      'agent:message',
      'agent:complete',
    ]);
  });
});
