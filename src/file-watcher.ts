import { watch, readFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TmuxManager } from './tmux-manager.js';
import type { StateStore } from './state-store.js';

const CWD = process.env.CE_HUB_CWD || process.cwd();
const CE_HUB_DIR = join(CWD, '.ce-hub');

function ensureDir(dir: string) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function readJson(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

export class FileWatcher {
  private tmux: TmuxManager;
  private store: StateStore;
  private watchers: ReturnType<typeof watch>[] = [];

  constructor(tmux: TmuxManager, store: StateStore) {
    this.tmux = tmux;
    this.store = store;
  }

  start(): void {
    const dispatchDir = join(CE_HUB_DIR, 'dispatch');
    const resultsDir = join(CE_HUB_DIR, 'results');
    ensureDir(dispatchDir);
    ensureDir(resultsDir);

    // Watch dispatch directory
    this.watchers.push(watch(dispatchDir, (event, filename) => {
      if (event === 'rename' && filename?.endsWith('.json')) {
        const filePath = join(dispatchDir, filename);
        if (!existsSync(filePath)) return;
        setTimeout(() => this.handleDispatch(filePath), 200); // debounce
      }
    }));

    // Watch results directory
    this.watchers.push(watch(resultsDir, (event, filename) => {
      if (event === 'rename' && filename?.endsWith('.json')) {
        const filePath = join(resultsDir, filename);
        if (!existsSync(filePath)) return;
        setTimeout(() => this.handleResult(filePath), 200);
      }
    }));

    // Process any existing dispatch/results files on startup
    this.processExisting(dispatchDir, (f) => this.handleDispatch(f));
    this.processExisting(resultsDir, (f) => this.handleResult(f));

    console.log(`[FileWatcher] watching ${dispatchDir} and ${resultsDir}`);
  }

  private processExisting(dir: string, handler: (path: string) => void): void {
    try {
      for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
        handler(join(dir, f));
      }
    } catch {}
  }

  private handleDispatch(filePath: string): void {
    const data = readJson(filePath);
    if (!data) return;

    const from = data.from as string;
    const to = data.to as string;
    const task = data.task as string;
    const taskId = data.id as string || `dispatch_${Date.now()}`;
    const priority = (data.priority as number) || 1;

    console.log(`[FileWatcher] dispatch: ${from} → ${to}: ${task?.slice(0, 60)}`);

    // Create task in DB
    this.store.createTask({
      title: task || 'Dispatched task', from_agent: from, to_agent: to,
      priority, payload: data as Record<string, unknown>,
    });

    // Log event
    this.store.createEvent({ type: 'dispatch', source: from, target: to, payload: { task, taskId } });

    // Ensure target agent inbox exists
    const inboxDir = join(CE_HUB_DIR, 'inbox', to);
    ensureDir(inboxDir);

    // Write task to target agent's inbox
    const inboxFile = join(inboxDir, `${taskId}.json`);
    writeFileSync(inboxFile, JSON.stringify({
      id: taskId, from, type: 'task', content: task,
      context: data.context || '', created_at: new Date().toISOString(),
    }, null, 2));

    // Start target agent if not running
    this.tmux.startAgent(to);

    // If agent is already running, notify it to check inbox
    if (this.tmux.isAlive(to)) {
      // Give it a moment to start, then send a nudge
      setTimeout(() => {
        this.tmux.sendMessage(to, `You have a new task in .ce-hub/inbox/${to}/. Read the JSON file and execute it.`);
      }, 3000);
    }

    // Move dispatch file to processed (or delete)
    try { unlinkSync(filePath); } catch {}
  }

  private handleResult(filePath: string): void {
    const data = readJson(filePath);
    if (!data) return;

    const from = data.from as string;
    const taskId = data.task_id as string;
    const status = data.status as string;
    const summary = data.summary as string;
    const outputFiles = data.output_files as string[] || [];

    console.log(`[FileWatcher] result: ${from} completed ${taskId}: ${status}`);

    // Update task in DB
    if (taskId) {
      const task = this.store.getTask(taskId);
      if (task) {
        this.store.updateTask(taskId, {
          status: status === 'done' ? 'done' : 'failed',
          result: data as Record<string, unknown>,
          completed_at: Date.now(),
        });
      }
    }

    // Log event
    this.store.createEvent({
      type: 'result', source: from,
      payload: { taskId, status, summary, outputFiles },
    });

    // Notify originating agent (from task record)
    if (taskId) {
      const task = this.store.getTask(taskId);
      if (task && task.from_agent) {
        const originInbox = join(CE_HUB_DIR, 'inbox', task.from_agent);
        ensureDir(originInbox);
        writeFileSync(join(originInbox, `result_${from}_${Date.now()}.json`), JSON.stringify({
          id: `result_${Date.now()}`, from, type: 'result',
          content: `[${from} ${status}] ${summary}`, task_id: taskId,
          output_files: outputFiles, created_at: new Date().toISOString(),
        }, null, 2));

        // Nudge originating agent
        if (this.tmux.isAlive(task.from_agent)) {
          this.tmux.sendMessage(task.from_agent, `Task completed by ${from}: ${summary?.slice(0, 200)}`);
        }
      }
    }

    // Move result file to archive (don't delete, keep for audit)
    // Already in results dir, that's fine
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
