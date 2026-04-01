import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { TerminalTile } from './components/TerminalTile';
import { SettingsPanel } from './components/SettingsPanel';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface AgentInfo { name: string; model: string; description: string; }

export const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: true, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

const THEMES = {
  dark: { bg: '#0d0d1a', headerBg: '#111122', border: '#222', muted: '#555', accent: '#4ade80' },
  light: { bg: '#f0f0f5', headerBg: '#fff', border: '#ddd', muted: '#999', accent: '#16a34a' },
};

function generateLayout(agents: string[]) {
  const layout: any[] = [];
  if (agents.includes('cc-lead')) layout.push({ i: 'cc-lead', x: 0, y: 0, w: 6, h: 14, minW: 3, minH: 4 });
  const others = agents.filter(a => a !== 'cc-lead');
  let row = 0;
  for (let idx = 0; idx < others.length; idx++) {
    const col = idx % 2;
    if (col === 0 && idx > 0) row += 7;
    layout.push({ i: others[idx], x: 6 + col * 3, y: row, w: 3, h: 7, minW: 2, minH: 3 });
  }
  return layout;
}

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('ce-hub-theme') !== 'light');
  const [connected, setConnected] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<{ remaining: string; session: string; total: string }>({ remaining: '', session: '', total: '' });
  const wsRef = useRef<WebSocket | null>(null);

  const theme = dark ? THEMES.dark : THEMES.light;
  const toggle = () => { setDark(d => { localStorage.setItem('ce-hub-theme', d ? 'light' : 'dark'); return !d; }); };

  // WebSocket connection
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket('ws://localhost:8750');
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); reconnectTimer = setTimeout(connect, 3000); };
      wsRef.current = ws;
    };
    connect();
    return () => { wsRef.current?.close(); clearTimeout(reconnectTimer); };
  }, []);

  // Fetch agents
  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(d => setAgents(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Poll token stats
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const resp = await fetch('/api/stats/tokens');
        const data = await resp.json();
        let sessionTotal = 0; let allTotal = 0;
        for (const [, v] of Object.entries(data) as [string, any][]) {
          allTotal += v.total_tokens || 0;
          sessionTotal += v.total_tokens || 0;
        }
        // Max plan: 5-hour window tokens (approximate)
        const maxTokens = 5_000_000; // rough 5h limit
        const remaining = Math.max(0, maxTokens - allTotal);
        setTokenInfo({
          remaining: remaining > 1_000_000 ? `${(remaining / 1_000_000).toFixed(1)}M` : `${(remaining / 1000).toFixed(0)}k`,
          session: allTotal > 1_000_000 ? `${(allTotal / 1_000_000).toFixed(2)}M` : `${(allTotal / 1000).toFixed(1)}k`,
          total: allTotal > 1_000_000 ? `${(allTotal / 1_000_000).toFixed(2)}M` : `${(allTotal / 1000).toFixed(1)}k`,
        });
      } catch {}
    }, 5_000);
    return () => clearInterval(poll);
  }, []);

  const allAgentNames = ['cc-lead', ...agents.map(a => a.name).filter(n => n !== 'cc-lead')];

  const [layouts, setLayouts] = useState<Record<string, any[]>>(() => {
    const saved = localStorage.getItem('ce-hub-layouts-v4');
    return saved ? JSON.parse(saved) : {};
  });

  const currentLayout = layouts.lg?.length >= allAgentNames.length
    ? layouts : { lg: generateLayout(allAgentNames), md: generateLayout(allAgentNames), sm: generateLayout(allAgentNames) };

  const handleLayoutChange = useCallback((_l: any[], all: Record<string, any[]>) => {
    setLayouts(all);
    localStorage.setItem('ce-hub-layouts-v4', JSON.stringify(all));
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: theme.bg }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', background: theme.headerBg, borderBottom: `1px solid ${theme.border}`,
          fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, color: theme.accent }}>ce-hub</span>
            <span style={{ color: connected ? theme.accent : '#f87171' }}>
              {connected ? '●' : '○'}
            </span>
            <span style={{ color: theme.muted }}>{allAgentNames.length} agents</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {tokenInfo.session && (
              <span style={{ color: theme.muted, fontSize: 10 }}>
                session: <span style={{ color: '#f7b84a' }}>{tokenInfo.session}</span>
                {' | '}
                remaining: <span style={{ color: parseInt(tokenInfo.remaining) > 1000 ? theme.accent : '#f87171' }}>{tokenInfo.remaining}</span>
              </span>
            )}
            <button onClick={toggle}
              style={{ background: 'none', border: `1px solid ${theme.border}`, color: theme.muted, borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              {dark ? '☀' : '☾'}
            </button>
            <button onClick={() => setShowSettings(true)}
              style={{ background: 'none', border: `1px solid ${theme.border}`, color: theme.muted, borderRadius: 3, padding: '2px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              settings
            </button>
          </div>
        </div>

        {/* Terminal Grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
          <ResponsiveGridLayout
            className="layout"
            layouts={currentLayout}
            breakpoints={{ lg: 1200, md: 900, sm: 600 }}
            cols={{ lg: 12, md: 9, sm: 6 }}
            rowHeight={35}
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[4, 4]}
          >
            {allAgentNames.map(name => (
              <div key={name}>
                <TerminalTile name={name} />
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>

        <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </ThemeContext.Provider>
  );
}
