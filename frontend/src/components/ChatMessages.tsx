import React, { useEffect, useRef } from 'react';
import { useTheme } from '../App';
import type { AgentMessage } from '../hooks/useWebSocket';

export function ChatMessages({ messages }: { messages: AgentMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { dark } = useTheme();
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const colors = dark
    ? { user: '#4a6cf7', system: '#f7b84a', assistant: '#4ade80', text: '#ccc' }
    : { user: '#3b5cf5', system: '#d97706', assistant: '#16a34a', text: '#333' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12 }}>
      {messages.length === 0 && <div style={{ color: '#444', fontSize: 11, textAlign: 'center', marginTop: 16 }}>~</div>}
      {messages.map((msg, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <span style={{ color: colors[msg.role] || colors.assistant, fontWeight: 600 }}>
            {msg.role === 'user' ? '> ' : msg.role === 'system' ? '! ' : '← '}
          </span>
          <span style={{ color: colors.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
