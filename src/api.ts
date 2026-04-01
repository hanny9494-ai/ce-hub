import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { StateStore } from './state-store.js';
import type { TaskEngine } from './task-engine.js';
import type { TmuxManager } from './tmux-manager.js';
import type { CostTracker } from './cost-tracker.js';
import type { MemoryManager } from './memory-manager.js';
import type { Scheduler } from './scheduler.js';

export async function buildApp(
  store: StateStore, engine: TaskEngine, tmux: TmuxManager,
  costTracker: CostTracker, memory: MemoryManager, scheduler: Scheduler,
) {
  const app = Fastify({ logger: true });
  const startTime = Date.now();
  await app.register(cors, { origin: true });

  // Health
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    taskCount: store.countTasks(),
    queueStats: engine.getQueueStats(),
    agents: tmux.listWindows(),
    costs: costTracker.getAgentCosts(),
  }));

  // Agents
  app.get('/api/agents', async () => tmux.listWindows());

  app.post<{ Params: { name: string } }>('/api/agents/:name/start', async (req) => {
    tmux.startAgent(req.params.name);
    return { ok: true, agent: req.params.name };
  });

  app.post<{ Params: { name: string } }>('/api/agents/:name/stop', async (req) => {
    tmux.killAgent(req.params.name);
    return { ok: true };
  });

  // Tasks
  app.get('/api/tasks', async (req) => {
    const q = req.query as { status?: string; toAgent?: string };
    return store.listTasks({ status: q.status as any, to_agent: q.toAgent });
  });

  app.post('/api/tasks', async (req, reply) => {
    try {
      const b = req.body as any;
      const task = await engine.createTask({
        title: b.title, from_agent: b.fromAgent || 'api', to_agent: b.toAgent,
        depends_on: b.dependsOn, priority: b.priority, payload: b.payload,
      });
      return reply.status(201).send(task);
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const t = store.getTask(req.params.id);
    return t || reply.status(404).send({ error: 'Not found' });
  });

  // Events
  app.get('/api/events', async () => store.listRecentEvents());

  // Costs
  app.get('/api/costs', async () => ({
    agents: costTracker.getAgentCosts(),
    session: costTracker.getSessionCosts(),
    daily: costTracker.getPeriodCost('daily'),
    weekly: costTracker.getPeriodCost('weekly'),
  }));

  // Memory
  app.get<{ Params: { name: string } }>('/api/agents/:name/memory', async (req) => {
    return memory.getMemory(req.params.name);
  });

  // Schedules
  app.get('/api/schedules', async () => scheduler.listSchedules());

  return app;
}
