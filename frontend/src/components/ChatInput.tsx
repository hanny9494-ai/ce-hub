import React, { useState } from 'react';
import { useTheme } from '../App';

export function ChatInput({ onSend, disabled }: { onSend: (s: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('');
  const { dark } = useTheme();

  const submit = () => { const t = value.trim(); if (t) { onSend(t); setValue(''); } };

  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${dark ? '#1a1a2e' : '#ddd'}`, background: dark ? '#0d0d18' : '#fafafa' }}>
      <span style={{ padding: '6px 4px 6px 8px', color: dark ? '#4a6cf7' : '#3b5cf5', fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12 }}>$</span>
      <input
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        disabled={disabled}
        style={{
          flex: 1, background: 'transparent', color: dark ? '#ccc' : '#333', border: 'none',
          padding: '6px 4px', fontSize: 12, fontFamily: 'SF Mono, Menlo, monospace', outline: 'none',
        }}
      />
    </div>
  );
}
