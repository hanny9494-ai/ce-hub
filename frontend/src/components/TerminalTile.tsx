import React, { useEffect, useState } from 'react';
import { useTheme } from '../App';

interface Props {
  name: string;
}

export function TerminalTile({ name }: Props) {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { dark } = useTheme();

  const t = dark
    ? { bg: '#0a0a14', border: '#1a1a2e', header: '#111122', label: '#8888aa', lead: '#4a6cf7', muted: '#444' }
    : { bg: '#fff', border: '#ddd', header: '#f5f5fa', label: '#666', lead: '#3b5cf5', muted: '#bbb' };

  const startTerminal = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/agents/${name}/terminal`, { method: 'POST' });
      const data = await resp.json();
      if (data.port) setPort(data.port);
    } catch (e) { console.error('Failed to start terminal:', e); }
    setLoading(false);
  };

  // Auto-start on mount
  useEffect(() => { startTerminal(); }, [name]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: t.bg, borderRadius: 4, border: `1px solid ${t.border}`,
      overflow: 'hidden', fontFamily: 'SF Mono, Menlo, monospace',
    }}>
      <div style={{
        padding: '4px 8px', background: t.header, borderBottom: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', gap: 6, minHeight: 24, fontSize: 11,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: port ? '#4ade80' : '#666' }} />
        <span style={{ fontWeight: 600, color: t.label }}>{name}</span>
        {name === 'cc-lead' && <span style={{ fontSize: 9, color: t.lead, marginLeft: 4 }}>LEAD</span>}
        {port && <span style={{ marginLeft: 'auto', fontSize: 9, color: t.muted }}>:{port}</span>}
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: t.muted, fontSize: 11 }}>
            starting terminal...
          </div>
        )}
        {port && (
          <iframe
            src={`http://localhost:${port}/${name}/`}
            style={{ width: '100%', height: '100%', border: 'none', background: dark ? '#0a0a14' : '#fff' }}
            title={`${name} terminal`}
          />
        )}
        {!port && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: t.muted, fontSize: 11 }}>terminal not started</span>
            <button onClick={startTerminal} style={{
              background: t.header, color: t.label, border: `1px solid ${t.border}`,
              borderRadius: 3, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            }}>start</button>
          </div>
        )}
      </div>
    </div>
  );
}
