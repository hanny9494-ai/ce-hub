import React, { useState, useEffect } from 'react';

interface KeyConfig {
  name: string;
  envVar: string;
  value: string;
  masked: boolean;
}

const DEFAULT_KEYS: Omit<KeyConfig, 'value' | 'masked'>[] = [
  { name: 'DashScope API Key', envVar: 'DASHSCOPE_API_KEY' },
  { name: 'Gemini API Key', envVar: 'GEMINI_API_KEY' },
  { name: 'L0 API Key', envVar: 'L0_API_KEY' },
  { name: 'L0 API Endpoint', envVar: 'L0_API_ENDPOINT' },
  { name: 'MinerU API Key', envVar: 'MINERU_API_KEY' },
  { name: 'Anthropic Base URL', envVar: 'ANTHROPIC_BASE_URL' },
  { name: 'New API Proxy', envVar: 'NEW_API_PROXY_URL' },
];

export function SettingsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [customName, setCustomName] = useState('');
  const [customEnv, setCustomEnv] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('ce-hub-keys');
    if (stored) {
      setKeys(JSON.parse(stored));
    } else {
      setKeys(DEFAULT_KEYS.map(k => ({ ...k, value: '', masked: true })));
    }
  }, []);

  const save = () => {
    localStorage.setItem('ce-hub-keys', JSON.stringify(keys));
    // Also POST to backend so server can use them
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keys.filter(k => k.value).map(k => ({ envVar: k.envVar, value: k.value }))),
    }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateKey = (idx: number, value: string) => {
    setKeys(prev => prev.map((k, i) => i === idx ? { ...k, value } : k));
  };

  const toggleMask = (idx: number) => {
    setKeys(prev => prev.map((k, i) => i === idx ? { ...k, masked: !k.masked } : k));
  };

  const addCustom = () => {
    if (!customName || !customEnv) return;
    setKeys(prev => [...prev, { name: customName, envVar: customEnv, value: '', masked: true }]);
    setCustomName('');
    setCustomEnv('');
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100vh',
      background: '#16162a', borderLeft: '1px solid #333', zIndex: 1000,
      display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>API Keys & Settings</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {keys.map((k, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>
              {k.name} <code style={{ color: '#666' }}>({k.envVar})</code>
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type={k.masked ? 'password' : 'text'}
                value={k.value}
                onChange={e => updateKey(i, e.target.value)}
                placeholder={`Enter ${k.envVar}...`}
                style={{
                  flex: 1, background: '#252545', color: '#e0e0e0', border: '1px solid #444',
                  borderRadius: 4, padding: '6px 10px', fontSize: 13, outline: 'none',
                }}
              />
              <button onClick={() => toggleMask(i)} style={{ background: '#333', border: 'none', color: '#999', borderRadius: 4, padding: '0 8px', cursor: 'pointer', fontSize: 12 }}>
                {k.masked ? 'show' : 'hide'}
              </button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 20, padding: '12px 0', borderTop: '1px solid #333' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Add Custom Key</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Display Name" style={{ flex: 1, background: '#252545', color: '#e0e0e0', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
            <input value={customEnv} onChange={e => setCustomEnv(e.target.value)} placeholder="ENV_VAR_NAME" style={{ flex: 1, background: '#252545', color: '#e0e0e0', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 12, outline: 'none' }} />
            <button onClick={addCustom} style={{ background: '#333', border: 'none', color: '#4a6cf7', borderRadius: 4, padding: '0 12px', cursor: 'pointer', fontSize: 12 }}>+</button>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, borderTop: '1px solid #333' }}>
        <button onClick={save} style={{
          width: '100%', background: saved ? '#22c55e' : '#4a6cf7', color: '#fff', border: 'none',
          borderRadius: 6, padding: '10px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
        }}>
          {saved ? 'Saved!' : 'Save Keys'}
        </button>
      </div>
    </div>
  );
}
