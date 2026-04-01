import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { StateStore } from './state-store.js';
import type { TaskEngine } from './task-engine.js';
import type { PtyManager } from './pty-manager.js';
import type { AgentManager } from './agent-manager.js';
import type { TaskFilter } from './types.js';

const CreateTaskSchema = z.object({
  title: z.string().min(1), fromAgent: z.string().min(1), toAgent: z.string().min(1),
  dependsOn: z.array(z.string()).optional().default([]),
  priority: z.number().int().min(0).max(10).optional().default(1),
  modelTier: z.enum(['opus', 'flash', 'ollama']).optional().default('opus'),
  payload: z.record(z.unknown()).optional().default({}),
  maxRetries: z.number().int().optional().default(3),
});

export async function buildApp(store: StateStore, engine: TaskEngine, agentManager: AgentManager, ptyManager?: PtyManager) {
  const app = Fastify({ logger: true });
  const startTime = Date.now();
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({
    status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000),
    taskCount: store.countTasks(), queueStats: engine.getQueueStats(),
  }));

  app.get<{ Querystring: { status?: string; toAgent?: string; fromAgent?: string } }>('/api/tasks', async (req) => {
    const f: TaskFilter = {};
    if (req.query.status) f.status = req.query.status as TaskFilter['status'];
    if (req.query.toAgent) f.to_agent = req.query.toAgent;
    if (req.query.fromAgent) f.from_agent = req.query.fromAgent;
    return store.listTasks(f);
  });

  app.post('/api/tasks', async (req, reply) => {
    try {
      const b = CreateTaskSchema.parse(req.body);
      const task = await engine.createTask({ title: b.title, from_agent: b.fromAgent, to_agent: b.toAgent, depends_on: b.dependsOn, priority: b.priority, model_tier: b.modelTier, payload: b.payload, max_retries: b.maxRetries });
      return reply.status(201).send(task);
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const t = store.getTask(req.params.id);
    return t ? t : reply.status(404).send({ error: 'Not found' });
  });

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const t = store.updateTask(req.params.id, req.body as Record<string, unknown>);
    return t ? t : reply.status(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    try { const t = engine.cancelTask(req.params.id); return t ? t : reply.status(404).send({ error: 'Not found' }); }
    catch (e) { return reply.status(409).send({ error: String(e) }); }
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async (req, reply) => {
    try { const t = await engine.retryTask(req.params.id); return t ? t : reply.status(404).send({ error: 'Not found' }); }
    catch (e) { return reply.status(409).send({ error: String(e) }); }
  });

  app.get('/api/events', async () => store.listRecentEvents());

  // Agent routes
  app.get('/api/agents', async () => agentManager.listAgents());

  // Message history
  app.get<{ Params: { name: string }; Querystring: { limit?: string } }>('/api/agents/:name/messages', async (req) => {
    const limit = parseInt(req.query.limit || '50');
    return store.getMessages(req.params.name, limit);
  });

  // Token stats
  app.get('/api/stats/tokens', async () => agentManager.getTokenStats());

  // Documents produced by agents
  app.get('/api/documents', async (req) => {
    const agent = (req.query as { agent?: string }).agent;
    return store.getDocuments(agent);
  });

  // Terminal: start ttyd for agent, return port
  app.post<{ Params: { name: string } }>('/api/agents/:name/terminal', async (req) => {
    if (!ptyManager) return { error: 'PTY manager not available' };
    const port = ptyManager.startAgent(req.params.name);
    return { port, url: `http://localhost:${port}/${req.params.name}/` };
  });

  app.get('/api/terminals', async () => {
    return ptyManager?.listSessions() || [];
  });

  app.post<{ Params: { name: string } }>('/api/agents/:name/message', async (req, reply) => {
    const { content } = req.body as { content?: string };
    if (!content) return reply.status(400).send({ error: 'content required' });
    try { const result = await agentManager.sendMessage(req.params.name, content); return { result }; }
    catch (e) { return reply.status(500).send({ error: String(e) }); }
  });

  // Settings: save API keys to process.env (runtime only)
  app.post('/api/settings/keys', async (req) => {
    const keys = req.body as Array<{ envVar: string; value: string }>;
    if (!Array.isArray(keys)) return { error: 'Expected array' };
    for (const { envVar, value } of keys) {
      if (envVar && value) process.env[envVar] = value;
    }
    return { saved: keys.length };
  });

  app.get('/api/settings/keys', async () => {
    const knownKeys = ['DASHSCOPE_API_KEY', 'GEMINI_API_KEY', 'L0_API_KEY', 'L0_API_ENDPOINT', 'MINERU_API_KEY', 'ANTHROPIC_BASE_URL'];
    return knownKeys.map(k => ({ envVar: k, hasValue: !!process.env[k] }));
  });

  // Context builder: generate resume prompt for an agent
  app.get<{ Params: { name: string } }>('/api/agents/:name/resume-prompt', async (req) => {
    // Lazy import to avoid circular deps
    const { ContextBuilder } = await import('./context-builder.js');
    const builder = new ContextBuilder(store);
    return { prompt: builder.buildResumePrompt(req.params.name) };
  });

  return app;
}
