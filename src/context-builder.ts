import { readFileSync, existsSync } from 'node:fs';
import type { StateStore } from './state-store.js';

const STATUS_PATH = '/Users/jeff/culinary-engine/STATUS.md';
const CLAUDE_MD_PATH = '/Users/jeff/culinary-engine/CLAUDE.md';

export class ContextBuilder {
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  buildResumePrompt(agentName: string): string {
    const activeTasks = this.formatActiveTasks();
    const recentDone = this.formatRecentCompleted();
    const statusMd = this.readFile(STATUS_PATH, 3000);
    const claudeMd = this.readFile(CLAUDE_MD_PATH, 2000);

    if (agentName === 'cc-lead') {
      return `# CC Lead Session Resume

你是 CC Lead，本项目的指挥中心。这是一个新 session，接续上一个 context 已满的 session。

## 当前项目状态 (STATUS.md 节选)
${statusMd}

## 活跃任务
${activeTasks || '无活跃任务'}

## 最近完成的任务
${recentDone || '无最近完成的任务'}

## 关键约束 (CLAUDE.md 节选)
${claudeMd}

---
上一个 session 因 context 满而结束。以上是完整的工作快照。
继续完成活跃任务，等待 Jeff 的下一条指令。`.trim();
    }

    return `# ${agentName} Session Resume

你是 ${agentName} agent，正在为 culinary-engine 项目工作。

## 当前分配给你的任务
${activeTasks || '无待办任务'}

## 最近完成的任务
${recentDone || '无'}

继续工作。`.trim();
  }

  private formatActiveTasks(): string {
    const tasks = this.store.listTasks({ status: 'running' })
      .concat(this.store.listTasks({ status: 'queued' }))
      .concat(this.store.listTasks({ status: 'pending' }));
    if (tasks.length === 0) return '';
    return tasks.slice(0, 20).map(t =>
      `- [${t.status}] ${t.title} (${t.from_agent} → ${t.to_agent})`
    ).join('\n');
  }

  private formatRecentCompleted(): string {
    const done = this.store.listTasks({ status: 'done' });
    const recent = done.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0)).slice(0, 10);
    if (recent.length === 0) return '';
    return recent.map(t => `- ${t.title} (${t.to_agent}, done)`).join('\n');
  }

  private readFile(path: string, maxChars: number): string {
    if (!existsSync(path)) return '(file not found)';
    try {
      const content = readFileSync(path, 'utf-8');
      return content.length > maxChars ? content.slice(0, maxChars) + '\n...(truncated)' : content;
    } catch { return '(read error)'; }
  }
}
