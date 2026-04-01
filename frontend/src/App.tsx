import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { AgentTile } from './components/AgentTile';
import { SettingsPanel } from './components/SettingsPanel';
import { useWebSocket } from './hooks/useWebSocket';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface AgentInfo { name: string; model: string; description: string; }

// Theme context
export const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: true, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

const THEMES = {
  dark: { bg: '#0d0d1a', headerBg: '#111122', border: '#222', tileBg: '#0a0a14', tileBorder: '#1a1a2e', tileHeader: '#111122', text: '#ccc', muted: '#555', accent: '#4ade80', input: '#4a6cf7' },
  light: { bg: '#f0f0f5', headerBg: '#fff', border: '#ddd', tileBg: '#fff', tileBorder: '#ddd', tileHeader: '#f8f8fc', text: '#333', muted: '#999', accent: '#16a34a', input: '#3b5cf5' },
};

function generateLayout(agents: string[]) {
  const layout: any[] = [];
  const ccIdx = agents.indexOf('cc-lead');
  if (ccIdx >= 0) layout.push({ i: 'cc-lead', x: 0, y: 0, w: 6, h: 14, minW: 3, minH: 4 });
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
  const { connected, messages, streaming, tokenStats, sendMessage, subscribe } = useWebSocket();

  const theme = dark ? THEMES.dark : THEMES.light;
  const toggle = () => { setDark(d => { localStorage.setItem('ce-hub-theme', d ? 'light' : 'dark'); return !d; }); };

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(data => setAgents(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const allAgentNames = ['cc-lead', ...agents.map(a => a.name).filter(n => n !== 'cc-lead')];

  const [layouts, setLayouts] = useState<Record<string, any[]>>(() => {
    const saved = localStorage.getItem('ce-hub-layouts-v3');
    return saved ? JSON.parse(saved) : {};
  });

  const currentLayout = layouts.lg?.length >= allAgentNames.length
    ? layouts : { lg: generateLayout(allAgentNames), md: generateLayout(allAgentNames), sm: generateLayout(allAgentNames) };

  const handleLayoutChange = useCallback((_l: any[], all: Record<string, any[]>) => {
    setLayouts(all);
    localStorage.setItem('ce-hub-layouts-v3', JSON.stringify(all));
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: theme.bg }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', background: theme.headerBg, borderBottom: `1px solid ${theme.border}`,
          fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, color: theme.accent }}>ce-hub</span>
            <span style={{ color: connected ? theme.accent : '#f87171' }}>
              {connected ? '● connected' : '○ disconnected'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: theme.muted }}>{allAgentNames.length} agents</span>
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
                <AgentTile
                  name={name}
                  messages={messages[name] || []}
                  streamingText={streaming[name]}
                  tokens={tokenStats[name]}
                  onSend={(content) => sendMessage(name, content)}
                  onSubscribe={() => subscribe(name)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>

        <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </ThemeContext.Provider>
  );
}
