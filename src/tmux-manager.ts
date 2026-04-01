import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDefinition } from './types.js';

const CWD = process.env.CE_HUB_CWD || process.cwd();
const SESSION = 'cehub';
const AGENTS_DIR = process.env.CE_HUB_AGENTS_DIR || '.claude/agents';
const MEMORY_DIR = join(CWD, '.ce-hub', 'memory');

function exec(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8', timeout: 5000, cwd: CWD }).trim(); } catch { return ''; }
}

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

// File protocol instructions injected into every agent
const PROTOCOL_PROMPT = `
## ce-hub Communication Protocol

You communicate with other agents through files:

### Receive tasks
Check .ce-hub/inbox/{your-name}/ for JSON task files. Read them to get your assignments.

### Dispatch to other agents
Write JSON to .ce-hub/dispatch/:
{"from":"your-name","to":"target-agent","task":"description","priority":1}

### Report results
When you complete a task, write JSON to .ce-hub/results/:
{"from":"your-name","task_id":"xxx","status":"done","summary":"what you did","output_files":["paths"]}

### Your memory
Your persistent memory is in .ce-hub/memory/{your-name}/. It was loaded at startup.
After completing important work, update your memory files to remember key decisions and findings.
`.trim();

export class TmuxManager {
  private defs = new Map<string, AgentDefinition>();

  initialize(): void {
    // Ensure tmux session exists
    if (!exec(`tmux has-session -t ${SESSION} 2>&1 && echo ok`).includes('ok')) {
      exec(`tmux new-session -d -s ${SESSION} -n dashboard -x 200 -y 50`);
      console.log(`[TmuxManager] created tmux session: ${SESSION}`);
    }

    // Load agent definitions
    if (existsSync(AGENTS_DIR)) {
      for (const f of readdirSync(AGENTS_DIR).filter((f: string) => f.endsWith('.md') && !f.startsWith('_'))) {
        const { meta, body } = parseFrontmatter(readFileSync(join(AGENTS_DIR, f), 'utf8'));
        const name = meta['name'] || f.replace('.md', '');
        this.defs.set(name, {
          name, description: meta['description'] || '',
          tools: meta['tools'] ? meta['tools'].split(',').map((t: string) => t.trim()) : [],
          model: meta['model'] || 'sonnet',
          systemPrompt: body,
        });
      }
    }
    // cc-lead always available
    if (!this.defs.has('cc-lead')) {
      this.defs.set('cc-lead', {
        name: 'cc-lead', description: 'CC Lead — 指挥中心',
        tools: [], model: 'opus',
        systemPrompt: 'You are CC Lead, the orchestration hub for culinary-engine.',
      });
    }
    console.log(`[TmuxManager] loaded ${this.defs.size} agent definitions`);
  }

  getDefinition(name: string): AgentDefinition | undefined { return this.defs.get(name); }
  getDefinitions(): AgentDefinition[] { return [...this.defs.values()]; }

  resolveCommand(def: AgentDefinition): string {
    const model = def.model.toLowerCase();
    // Load agent memory if exists
    const memoryDir = join(MEMORY_DIR, def.name);
    let memoryAppend = '';
    if (existsSync(memoryDir)) {
      try {
        const files = readdirSync(memoryDir).filter((f: string) => f.endsWith('.md'));
        const contents = files.map((f: string) => readFileSync(join(memoryDir, f), 'utf8')).join('\n\n');
        if (contents.trim()) memoryAppend = contents;
      } catch {}
    }

    const appendPrompt = [PROTOCOL_PROMPT, memoryAppend].filter(Boolean).join('\n\n');
    const escapedAppend = appendPrompt.replace(/'/g, "'\\''");

    if (model === 'codex') {
      return `codex exec --dangerously-bypass-approvals-and-sandbox`;
    }
    if (model.startsWith('gemini')) {
      return `python3 scripts/gemini_agent.py --model ${model}`;
    }

    // Default: claude
    const claudeModel = model === 'opus' ? 'opus' : model === 'haiku' ? 'haiku' : 'sonnet';
    return `claude --model ${claudeModel} --dangerously-skip-permissions --append-system-prompt '${escapedAppend}'`;
  }

  startAgent(agentName: string): boolean {
    if (this.isAlive(agentName)) {
      console.log(`[TmuxManager] ${agentName} already running`);
      return true;
    }

    const def = this.defs.get(agentName);
    if (!def) { console.error(`[TmuxManager] unknown agent: ${agentName}`); return false; }

    const cmd = this.resolveCommand(def);
    console.log(`[TmuxManager] starting ${agentName}: ${cmd.slice(0, 80)}...`);

    exec(`tmux new-window -t ${SESSION} -n ${agentName} 'cd ${CWD} && ${cmd}'`);
    return true;
  }

  // Send a message to agent's tmux window (types it + hits enter)
  sendMessage(agentName: string, message: string): void {
    if (!this.isAlive(agentName)) this.startAgent(agentName);
    const escaped = message.replace(/'/g, "'\\''").replace(/\n/g, ' ');
    exec(`tmux send-keys -t ${SESSION}:${agentName} '${escaped}' Enter`);
  }

  isAlive(agentName: string): boolean {
    return exec(`tmux list-windows -t ${SESSION} -F '#{window_name}' 2>/dev/null`).split('\n').includes(agentName);
  }

  listWindows(): { name: string; alive: boolean }[] {
    const windows = exec(`tmux list-windows -t ${SESSION} -F '#{window_name}' 2>/dev/null`).split('\n').filter(Boolean);
    return this.getDefinitions().map(d => ({ name: d.name, alive: windows.includes(d.name) }));
  }

  killAgent(agentName: string): void {
    exec(`tmux send-keys -t ${SESSION}:${agentName} C-c`);
    exec(`tmux kill-window -t ${SESSION}:${agentName} 2>/dev/null`);
    console.log(`[TmuxManager] killed ${agentName}`);
  }

  shutdown(): void {
    exec(`tmux kill-session -t ${SESSION} 2>/dev/null`);
  }
}
