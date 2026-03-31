import EventEmitter2pkg from 'eventemitter2';
const { EventEmitter2 } = EventEmitter2pkg as any;
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import toposort from 'toposort';
import type { StateStore } from './state-store.js';
import type { Task, CreateTaskInput } from './types.js';

export class TaskEngine {
  private store: StateStore;
  public emitter: EventEmitter2;
  private queues: Record<string, PQueue>;

  constructor(store: StateStore) {
    this.store = store;
    this.emitter = new EventEmitter2({ wildcard: true });
    this.queues = {
      opus: new PQueue({ concurrency: 3 }),
      flash: new PQueue({ concurrency: 3 }),
      ollama: new PQueue({ concurrency: 1 }),
    };
  }

  validateDag(taskId: string, dependsOn: string[]): void {
    if (dependsOn.length === 0) return;
    const edges: [string, string][] = [];
    for (const t of this.store.listTasks()) for (const dep of t.depends_on) edges.push([dep, t.id]);
    for (const dep of dependsOn) edges.push([dep, taskId]);
    try { toposort(edges); } catch (err) { throw new Error(`Dependency cycle: ${err}`); }
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = this.store.createTask(input);
    try { this.validateDag(task.id, task.depends_on); } catch (err) {
      this.store.updateTask(task.id, { status: 'failed', error: String(err) }); throw err;
    }
    this.store.createEvent({ type: `task.created`, source: task.from_agent, target: task.to_agent, payload: { taskId: task.id, title: task.title } });
    this.emitter.emit(`task.${task.id}.created`, task);
    if (task.depends_on.length === 0) await this.queueTask(task.id);
    return this.store.getTask(task.id)!;
  }

  private async queueTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== 'pending') return;
    this.store.updateTask(taskId, { status: 'queued' });
    const tier = task.model_tier in this.queues ? task.model_tier : 'opus';
    this.queues[tier].add(() => this.runTask(taskId)).catch(e => console.error(`[task-engine] queue error ${taskId}:`, e));
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task || (task.status !== 'queued' && task.status !== 'pending')) return;
    this.store.updateTask(taskId, { status: 'running', started_at: Date.now() });
    this.emitter.emit(`task.${taskId}.started`, task);
    try {
      const result = await pRetry(() => this.executeTask(taskId), {
        retries: task.max_retries,
        onFailedAttempt: (e) => { console.warn(`[task-engine] ${taskId} attempt ${e.attemptNumber} failed`); this.store.incrementTaskRetry(taskId); },
      });
      this.store.updateTask(taskId, { status: 'done', result, completed_at: Date.now() });
      this.emitter.emit(`task.${taskId}.completed`, result);
      await this.triggerDownstream(taskId);
    } catch (err) {
      const t = this.store.getTask(taskId)!;
      const status = t.retry_count >= t.max_retries ? 'dead_letter' : 'failed';
      this.store.updateTask(taskId, { status, error: String(err), completed_at: Date.now() });
      this.emitter.emit(`task.${taskId}.failed`, { error: String(err), status });
    }
  }

  // Phase 1 mock — will be replaced by AgentManager in Phase 2
  private async executeTask(_taskId: string): Promise<Record<string, unknown>> {
    await new Promise(r => setTimeout(r, 2000));
    return { mock: true, completedAt: new Date().toISOString() };
  }

  private async triggerDownstream(completedId: string): Promise<void> {
    for (const t of this.store.getTasksWaitingOnDep(completedId)) {
      if (t.depends_on.every(d => this.store.getTask(d)?.status === 'done')) await this.queueTask(t.id);
    }
  }

  async retryTask(taskId: string): Promise<Task | null> {
    const t = this.store.getTask(taskId);
    if (!t || (t.status !== 'failed' && t.status !== 'dead_letter')) return null;
    this.store.updateTask(taskId, { status: 'pending', error: undefined });
    await this.queueTask(taskId);
    return this.store.getTask(taskId);
  }

  cancelTask(taskId: string): Task | null {
    const t = this.store.getTask(taskId);
    if (!t || (t.status !== 'pending' && t.status !== 'queued')) return null;
    return this.store.updateTask(taskId, { status: 'failed', error: 'Cancelled' });
  }

  getQueueStats() {
    return Object.fromEntries(Object.entries(this.queues).map(([k, q]) => [k, { size: q.size, pending: q.pending }]));
  }
}
