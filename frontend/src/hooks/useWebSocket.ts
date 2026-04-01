import { useEffect, useRef, useCallback, useState } from 'react';

export interface AgentMessage {
  agentName: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>({});
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [tokenStats, setTokenStats] = useState<Record<string, { total_tokens: number; api_calls: number }>>({});
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load message history from DB on mount
  const loadHistory = useCallback(async (agentName: string) => {
    try {
      const resp = await fetch(`/api/agents/${agentName}/messages?limit=50`);
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        setMessages(prev => ({
          ...prev,
          [agentName]: data.map((m: any) => ({
            agentName, role: m.role, content: m.content, timestamp: m.created_at,
          })),
        }));
      }
    } catch {}
  }, []);

  // Poll token stats
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const resp = await fetch('/api/stats/tokens');
        const data = await resp.json();
        setTokenStats(data);
      } catch {}
    }, 10_000);
    return () => clearInterval(poll);
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://localhost:8750');

    ws.onopen = () => { setConnected(true); };
    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stream_chunk' && msg.agentName) {
          // Streaming: replace with latest partial (each chunk is full text so far)
          setStreaming(prev => ({
            ...prev,
            [msg.agentName]: msg.chunk || '',
          }));
        } else if (msg.type === 'agent_message' && msg.agentName) {
          // Final message: clear streaming, add to messages
          setStreaming(prev => { const n = { ...prev }; delete n[msg.agentName]; return n; });
          setMessages(prev => {
            const existing = prev[msg.agentName] || [];
            const last = existing[existing.length - 1];
            if (last && last.content === msg.content && last.role === (msg.role || 'assistant')) return prev;
            return {
              ...prev,
              [msg.agentName]: [...existing, {
                agentName: msg.agentName, role: msg.role || 'assistant',
                content: msg.content, timestamp: msg.timestamp || Date.now(),
              }],
            };
          });
        }
      } catch {}
    };
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); clearTimeout(reconnectTimer.current); };
  }, [connect]);

  const sendMessage = useCallback((agentName: string, content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => ({
      ...prev,
      [agentName]: [...(prev[agentName] || []), { agentName, role: 'user', content, timestamp: Date.now() }],
    }));
    wsRef.current.send(JSON.stringify({ type: 'send_message', agentName, content }));
  }, []);

  const subscribe = useCallback((agentName: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', agentName }));
    }
    loadHistory(agentName);
  }, [loadHistory]);

  return { connected, messages, streaming, tokenStats, sendMessage, subscribe };
}
