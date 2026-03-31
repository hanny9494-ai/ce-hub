import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentDefinition } from './types.js';

const AGENTS_DIR = process.env.CE_HUB_AGENTS_DIR || '.claude/agents';
const CWD = process.env.CE_HUB_CWD || process.cwd();
const MOCK = process.env.CE_HUB_MOCK === '1';

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

interface AgentProcess {
  proc: ChildProcess;
  buffer: string;
  pendingResolve: ((text: string) => void) | null;
  pendingReject: ((err: Error) => void) | null;
}

export class AgentManager {
  private defs = new Map<string, AgentDefinition>();
  private procs = new Map<string, AgentProcess>();

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
    // cc-lead is always available even without a file
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
    }));
  }

  private spawnAgent(agentName: string): AgentProcess {
    console.log(`[AgentManager] spawning persistent process for ${agentName}...`);
    const proc = spawn('claude', [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--model', 'sonnet', '--verbose',
    ], { cwd: CWD });

    const agent: AgentProcess = { proc, buffer: '', pendingResolve: null, pendingReject: null };

    proc.stdout!.on('data', (data: Buffer) => {
      agent.buffer += data.toString();
      const lines = agent.buffer.split('\n');
      agent.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'assistant' && msg.message?.content && agent.pendingResolve) {
            const text = msg.message.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text || '')
              .join('');
            if (text) {
              const resolve = agent.pendingResolve;
              agent.pendingResolve = null;
              agent.pendingReject = null;
              resolve(text);
            }
          } else if (msg.type === 'result' && agent.pendingResolve) {
            const text = typeof msg.result === 'string' ? msg.result :
              (msg.result?.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') || '');
            if (text) {
              const resolve = agent.pendingResolve;
              agent.pendingResolve = null;
              agent.pendingReject = null;
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
      }
    });

    this.procs.set(agentName, agent);
    return agent;
  }

  async sendMessage(agentName: string, message: string): Promise<string> {
    const def = this.defs.get(agentName);
    if (!def) throw new Error(`Agent not found: ${agentName}`);
    if (MOCK) { await new Promise(r => setTimeout(r, 500)); return `[MOCK] ${agentName}: done`; }

    // Get or create persistent process
    let agent = this.procs.get(agentName);
    if (!agent || agent.proc.killed) {
      agent = this.spawnAgent(agentName);
    }

    console.log(`[AgentManager] sending to ${agentName} (hot session)...`);

    return new Promise<string>((resolve, reject) => {
      agent!.pendingResolve = resolve;
      agent!.pendingReject = reject;

      const input = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message },
      }) + '\n';

      agent!.proc.stdin!.write(input);

      // Timeout after 2 minutes
      setTimeout(() => {
        if (agent!.pendingResolve === resolve) {
          agent!.pendingResolve = null;
          agent!.pendingReject = null;
          reject(new Error('Timeout waiting for response'));
        }
      }, 120_000);
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
