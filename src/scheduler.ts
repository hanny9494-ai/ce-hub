import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

function getCwd() { return process.env.CE_HUB_CWD || process.cwd(); }
const SCHEDULES_FILE = join(getCwd(), '.ce-hub', 'schedules.json');

// System task commands (agent: "system")
const SYSTEM_TASKS: Record<string, string> = {
  'compile-wiki': 'python3 scripts/compile-wiki.py',
  'compile-wiki-full': 'python3 scripts/compile-wiki.py --full',
};

interface Schedule {
  cron: string;        // simplified: "HH:MM" for daily, or "*/N" for interval minutes
  task: string;
  agent: string;
  enabled?: boolean;
}

export class Scheduler {
  private schedules: Schedule[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private onTrigger: ((agent: string, task: string) => void) | null = null;

  initialize(callback: (agent: string, task: string) => void): void {
    this.onTrigger = callback;
    if (existsSync(SCHEDULES_FILE)) {
      try { this.schedules = JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8')); } catch {}
    } else {
      // Default schedules
      this.schedules = [
        { cron: '23:00', task: '生成日报：读 STATUS.md 和今天的 git log，写一份日报到 reports/', agent: 'cc-lead' },
      ];
      writeFileSync(SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2));
    }

    this.startAll();
    console.log(`[Scheduler] loaded ${this.schedules.length} schedules`);
  }

  private startAll(): void {
    // Check every minute
    const timer = setInterval(() => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      for (const s of this.schedules) {
        if (s.enabled === false) continue;

        if (s.cron.includes(':')) {
          // HH:MM format — trigger once when time matches
          if (s.cron === hhmm && now.getSeconds() < 60) {
            console.log(`[Scheduler] triggering: ${s.task} → ${s.agent}`);
            this.triggerTask(s);
          }
        } else if (s.cron.startsWith('*/')) {
          // Interval format — */N means every N minutes
          const interval = parseInt(s.cron.slice(2));
          if (interval > 0 && now.getMinutes() % interval === 0 && now.getSeconds() < 60) {
            console.log(`[Scheduler] triggering: ${s.task} → ${s.agent}`);
            this.triggerTask(s);
          }
        }
      }
    }, 60_000);

    this.timers.push(timer);
  }

  private triggerTask(s: Schedule): void {
    if (s.agent === 'system') {
      // System tasks: run script directly, no dispatch
      const cmd = SYSTEM_TASKS[s.task];
      if (!cmd) {
        console.error(`[Scheduler] unknown system task: ${s.task}`);
        return;
      }
      try {
        const cwd = join(getCwd(), 'ce-hub');
        console.log(`[Scheduler] running system task: ${cmd}`);
        execSync(cmd, { cwd, timeout: 300_000, stdio: 'inherit', env: { ...process.env, CE_HUB_CWD: getCwd() } });
        console.log(`[Scheduler] system task completed: ${s.task}`);
      } catch (err) {
        console.error(`[Scheduler] system task failed: ${s.task}:`, err);
      }
    } else {
      // Agent tasks: dispatch via file protocol
      this.onTrigger?.(s.agent, s.task);
    }
  }

  addSchedule(schedule: Schedule): void {
    this.schedules.push(schedule);
    writeFileSync(SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2));
  }

  listSchedules(): Schedule[] { return this.schedules; }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
