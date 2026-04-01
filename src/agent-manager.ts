import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentDefinition } from './types.js';
import type { StateStore } from './state-store.js';
import type { MessageRouter } from './message-router.js';

const AGENTS_DIR = process.env.CE_HUB_AGENTS_DIR || '.claude/agents';
const CWD = process.env.CE_HUB_CWD || process.cwd();
const MOCK = process.env.CE_HUB_MOCK === '1';
const CONSOLIDATE_THRESHOLD = 120_000; // ~120k tokens, consolidate memory

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

// Extract file paths from text
const FILE_PATH_RE = /(?:\/[\w.-]+){2,}(?:\.\w+)?/g;
function extractFilePaths(text: string): string[] {
  return [...new Set((text.match(FILE_PATH_RE) || []).filter(p => !p.includes('http')))];
}

interface AgentProcess {
  proc: ChildProcess;
  buffer: string;
  pendingResolve: ((text: string) => void) | null;
  pendingReject: ((err: Error) => void) | null;
  streamCallback: ((chunk: string) => void) | null;
}

// Token usage tracking
interface TokenStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  api_calls: number;
}

export class AgentManager {
  private defs = new Map<string, AgentDefinition>();
  private procs = new Map<string, AgentProcess>();
  private store: StateStore | null = null;
  private router: MessageRouter | null = null;
  private tokenStats = new Map<string, TokenStats>();

  setStore(store: StateStore) { this.store = store; }
  setRouter(router: MessageRouter) { this.router = router; }

  async initialize(): Promise<void> {
    if (!existsSync(AGENTS_DIR)) { console.warn('[AgentManager] agents dir not found'); return; }
    for (const f of readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md') && !f.startsWith('_'))) {
      try {
        const { meta, body } = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), 'utf8'));
        const name = meta['name'] || basename(f, '.md');
        this.defs.set(name, {
          name, description: meta['description'] || '',
          tools: meta['tools'] ? meta['tools'].split(',').map(t => t.trim()) : [],
          model: meta['model'] || 'sonnet',
          systemPrompt: body,
        });
      } catch (e) { console.error(`[AgentManager] failed to load ${f}:`, e); }
    }
    if (!this.defs.has('cc-lead')) {
      this.defs.set('cc-lead', {
        name: 'cc-lead', description: 'CC Lead — 指挥中心',
        tools: [], model: 'opus',
        systemPrompt: 'You are CC Lead, the orchestration hub for the culinary-engine project. You dispatch tasks to other agents, track progress, and report to Jeff.',
      });
    }
    console.log(`[AgentManager] loaded ${this.defs.size} agents`);
  }

  getDefinitions(): AgentDefinition[] { return [...this.defs.values()]; }

  listAgents() {
    return [...this.defs.values()].map(d => ({
      name: d.name, model: d.model, description: d.description,
      alive: this.procs.has(d.name),
      tokens: this.tokenStats.get(d.name) || { input_tokens: 0, output_tokens: 0, total_tokens: 0, api_calls: 0 },
    }));
  }

  getTokenStats(): Record<string, TokenStats> {
    const result: Record<string, TokenStats> = {};
    for (const [name, stats] of this.tokenStats) result[name] = { ...stats };
    return result;
  }

  private trackTokens(agentName: string, input: number, output: number) {
    const s = this.tokenStats.get(agentName) || { input_tokens: 0, output_tokens: 0, total_tokens: 0, api_calls: 0 };
    s.input_tokens += input;
    s.output_tokens += output;
    s.total_tokens += input + output;
    s.api_calls += 1;
    this.tokenStats.set(agentName, s);
  }

  private spawnAgent(agentName: string): AgentProcess {
    console.log(`[AgentManager] spawning persistent process for ${agentName}...`);
    const proc = spawn('claude', [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--model', 'sonnet', '--verbose',
    ], { cwd: CWD });

    const agent: AgentProcess = { proc, buffer: '', pendingResolve: null, pendingReject: null, streamCallback: null };

    proc.stdout!.on('data', (data: Buffer) => {
      agent.buffer += data.toString();
      const lines = agent.buffer.split('\n');
      agent.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // Track tokens from rate_limit_event
          if (msg.type === 'rate_limit_event' && msg.usage) {
            this.trackTokens(agentName, msg.usage.input_tokens || 0, msg.usage.output_tokens || 0);
          }

          if (msg.type === 'assistant' && msg.message?.content) {
            const text = msg.message.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text || '')
              .join('');
            // Stream chunk to frontend
            if (text && agent.streamCallback) agent.streamCallback(text);
            if (text && agent.pendingResolve) {
              const resolve = agent.pendingResolve;
              agent.pendingResolve = null;
              agent.pendingReject = null;
              agent.streamCallback = null;
              resolve(text);
            }
          } else if (msg.type === 'result' && agent.pendingResolve) {
            const text = typeof msg.result === 'string' ? msg.result :
              (msg.result?.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') || '');
            if (text) {
              const resolve = agent.pendingResolve;
              agent.pendingResolve = null;
              agent.pendingReject = null;
              agent.streamCallback = null;
              resolve(text);
            }
          }
        } catch {}
      }
    });

    proc.stderr!.on('data', () => {});
    proc.on('exit', (code) => {
      console.log(`[AgentManager] ${agentName} process exited (${code})`);
      this.procs.delete(agentName);
      if (agent.pendingReject) {
        agent.pendingReject(new Error(`Process exited with code ${code}`));
        agent.pendingResolve = null;
        agent.pendingReject = null;
        agent.streamCallback = null;
      }
    });

    this.procs.set(agentName, agent);
    return agent;
  }

  async sendMessage(agentName: string, message: string, onStream?: (chunk: string) => void): Promise<string> {
    const def = this.defs.get(agentName);
    if (!def) throw new Error(`Agent not found: ${agentName}`);

    // Persist user message
    this.store?.addMessage(agentName, 'user', message);

    if (MOCK) { await new Promise(r => setTimeout(r, 500)); const reply = `[MOCK] ${agentName}: done`; this.store?.addMessage(agentName, 'assistant', reply); return reply; }

    // Check if memory consolidation needed
    await this.maybeConsolidate(agentName);

    let agent = this.procs.get(agentName);
    if (!agent || agent.proc.killed) {
      agent = this.spawnAgent(agentName);
    }

    console.log(`[AgentManager] sending to ${agentName} (hot session)...`);

    return new Promise<string>((resolve, reject) => {
      agent!.pendingResolve = (text: string) => {
        // Persist assistant message
        this.store?.addMessage(agentName, 'assistant', text);
        // Track document outputs
        const paths = extractFilePaths(text);
        for (const p of paths) this.store?.trackDocument(agentName, p, 'output');
        resolve(text);
      };
      agent!.pendingReject = reject;
      agent!.streamCallback = onStream || null;

      agent!.proc.stdin!.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message },
      }) + '\n');

      setTimeout(() => {
        if (agent!.pendingResolve) {
          agent!.pendingResolve = null;
          agent!.pendingReject = null;
          agent!.streamCallback = null;
          reject(new Error('Timeout waiting for response'));
        }
      }, 120_000);
    });
  }

  private async maybeConsolidate(agentName: string): Promise<void> {
    if (!this.store) return;
    const tokens = this.store.getConversationTokenCount(agentName);
    if (tokens < CONSOLIDATE_THRESHOLD) return;

    console.log(`[AgentManager] consolidating memory for ${agentName} (${tokens} tokens)...`);

    // Get recent messages to summarize
    const messages = this.store.getMessages(agentName, 100);
    const old = messages.slice(0, -10); // Keep last 10
    if (old.length < 5) return;

    const summaryText = old.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
    const summary = `Conversation summary (${old.length} messages archived): Key topics discussed — ${summaryText.slice(0, 1000)}`;

    this.store.consolidateMemory(agentName, summary, 10);

    // Notify frontend
    this.router?.broadcastToAgent(agentName, {
      type: 'agent_message', agentName, role: 'system',
      content: `[Memory consolidated: ${old.length} old messages archived, last 10 kept]`,
      timestamp: Date.now(),
    });
  }

  shutdown(): void {
    for (const [name, agent] of this.procs) {
      console.log(`[AgentManager] killing ${name}`);
      agent.proc.kill();
    }
    this.procs.clear();
  }
}
