import React, { useEffect } from 'react';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { useTheme } from '../App';
import type { AgentMessage } from '../hooks/useWebSocket';

interface Props {
  name: string;
  messages: AgentMessage[];
  streamingText?: string;
  tokens?: { total_tokens: number; api_calls: number };
  onSend: (content: string) => void;
  onSubscribe: () => void;
}

export function AgentTile({ name, messages, streamingText, tokens, onSend, onSubscribe }: Props) {
  useEffect(() => { onSubscribe(); }, [onSubscribe]);
  const { dark } = useTheme();
  const t = dark
    ? { bg: '#0a0a14', border: '#1a1a2e', header: '#111122', label: '#8888aa', lead: '#4a6cf7', muted: '#444' }
    : { bg: '#fff', border: '#ddd', header: '#f5f5fa', label: '#666', lead: '#3b5cf5', muted: '#bbb' };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: t.bg, borderRadius: 4, border: `1px solid ${t.border}`,
      overflow: 'hidden', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12,
    }}>
      <div style={{
        padding: '4px 8px', background: t.header, borderBottom: `1px solid ${t.border}`,
        minHeight: 24, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: streamingText ? '#f7b84a' : messages.length > 0 ? '#4ade80' : '#333' }} />
        <span style={{ fontWeight: 600, fontSize: 11, color: t.label }}>{name}</span>
        {name === 'cc-lead' && <span style={{ fontSize: 9, color: t.lead, marginLeft: 4 }}>LEAD</span>}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: t.muted }}>
          {tokens && tokens.total_tokens > 0 ? `${(tokens.total_tokens / 1000).toFixed(1)}k tok` : ''}
        </span>
      </div>
      <ChatMessages messages={messages} streamingText={streamingText} />
      <ChatInput onSend={onSend} disabled={!!streamingText} />
    </div>
  );
}
