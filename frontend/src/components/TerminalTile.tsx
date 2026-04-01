import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../App';

interface Props {
  name: string;
  wsRef: React.RefObject<WebSocket | null>;
  connected: boolean;
}

export function TerminalTile({ name, wsRef, connected }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const attached = useRef(false);
  const { dark } = useTheme();

  useEffect(() => {
    if (!termRef.current || termInstance.current) return;

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'SF Mono, Menlo, Monaco, monospace',
      cursorBlink: true,
      theme: dark ? {
        background: '#0a0a14',
        foreground: '#cccccc',
        cursor: '#4ade80',
        selectionBackground: '#264f78',
      } : {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#333333',
        selectionBackground: '#add6ff',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(termRef.current);
    fit.fit();

    termInstance.current = term;
    fitAddon.current = fit;

    // Send keyboard input to backend PTY
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'pty_input', agentName: name, data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'pty_resize', agentName: name,
            cols: term.cols, rows: term.rows,
          }));
        }
      } catch {}
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termInstance.current = null;
    };
  }, [name, dark]);

  // Attach to PTY when connected
  useEffect(() => {
    if (!connected || !wsRef.current || attached.current) return;
    attached.current = true;
    wsRef.current.send(JSON.stringify({ type: 'pty_attach', agentName: name }));
  }, [connected, name]);

  // Listen for PTY output
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pty_output' && msg.agentName === name && termInstance.current) {
          termInstance.current.write(msg.data);
        }
        if (msg.type === 'pty_exit' && msg.agentName === name && termInstance.current) {
          termInstance.current.write('\r\n[Process exited]\r\n');
        }
      } catch {}
    };

    const ws = wsRef.current;
    if (ws) ws.addEventListener('message', handleMessage);
    return () => { if (ws) ws.removeEventListener('message', handleMessage); };
  }, [name, connected]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: dark ? '#0a0a14' : '#fff', borderRadius: 4,
      border: `1px solid ${dark ? '#1a1a2e' : '#ddd'}`, overflow: 'hidden',
    }}>
      <div style={{
        padding: '4px 8px', background: dark ? '#111122' : '#f5f5fa',
        borderBottom: `1px solid ${dark ? '#1a1a2e' : '#ddd'}`,
        display: 'flex', alignItems: 'center', gap: 6, minHeight: 24,
        fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#4ade80' : '#666' }} />
        <span style={{ fontWeight: 600, color: dark ? '#8888aa' : '#666' }}>{name}</span>
        {name === 'cc-lead' && <span style={{ fontSize: 9, color: '#4a6cf7', marginLeft: 4 }}>LEAD</span>}
      </div>
      <div ref={termRef} style={{ flex: 1, padding: 2 }} />
    </div>
  );
}
