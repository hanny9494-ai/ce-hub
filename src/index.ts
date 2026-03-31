// Don't modify process.env — claude CLI needs clean env for OAuth

import { StateStore } from './state-store.js';
import { TaskEngine } from './task-engine.js';
import { AgentManager } from './agent-manager.js';
import { MessageRouter } from './message-router.js';
import { ContextBuilder } from './context-builder.js';
import { buildApp } from './api.js';
import { setupBridge } from './bridge.js';

const DB_PATH = '/Users/jeff/culinary-engine/ce-hub/ce-hub.db';
const PORT = 8750;

async function main() {
  console.log('[ce-hub] Starting...');
  const store = new StateStore(DB_PATH);
  const engine = new TaskEngine(store);
  const agentManager = new AgentManager();
  await agentManager.initialize();
  const router = new MessageRouter(store);
  const contextBuilder = new ContextBuilder(store);

  const app = await buildApp(store, engine, agentManager);

  // Wire task events to WebSocket broadcast
  engine.emitter.on('task.*.created', (t: unknown) => router.broadcastAll({ type: 'task_update', event: 'created', task: t }));
  engine.emitter.on('task.*.completed', (r: unknown) => router.broadcastAll({ type: 'task_update', event: 'completed', result: r }));
  engine.emitter.on('task.*.failed', (e: unknown) => router.broadcastAll({ type: 'task_update', event: 'failed', error: e }));

  // Bridge: intercept dispatch commands (@agent: message)
  const handleBridge = setupBridge(agentManager, router);

  // Wire frontend messages → check for @dispatch first, then send to agent
  router.emitter.on('client.message.*', async (data: { agentName: string; content: string; clientId: string }) => {
    const { agentName, content } = data;
    console.log(`[ce-hub] Message to ${agentName}: ${content.slice(0, 80)}`);

    // Check if USER input has @agent: dispatch (direct bridge from any tile)
    const { parseDispatches } = await import('./bridge.js');
    const userDispatches = parseDispatches(content);
    if (userDispatches.length > 0) {
      for (const { targetAgent, message } of userDispatches) {
        console.log(`[bridge] user → @${targetAgent}: ${message.slice(0, 60)}`);
        // Show in source tile
        router.broadcastToAgent(agentName, {
          type: 'agent_message', agentName, role: 'system',
          content: `→ dispatched to ${targetAgent}`, timestamp: Date.now(),
        });
        // Show in target tile
        router.broadcastToAgent(targetAgent, {
          type: 'agent_message', agentName: targetAgent, role: 'system',
          content: `[from ${agentName}] ${message}`, timestamp: Date.now(),
        });
        // Execute on target
        try {
          const result = await agentManager.sendMessage(targetAgent, message);
          router.broadcastToAgent(targetAgent, {
            type: 'agent_message', agentName: targetAgent, role: 'assistant',
            content: result, timestamp: Date.now(),
          });
          // Report back to source
          router.broadcastToAgent(agentName, {
            type: 'agent_message', agentName, role: 'system',
            content: `[${targetAgent} done] ${result.slice(0, 500)}`, timestamp: Date.now(),
          });
        } catch (err) {
          router.broadcastToAgent(targetAgent, {
            type: 'agent_message', agentName: targetAgent, role: 'system',
            content: `Error: ${err}`, timestamp: Date.now(),
          });
        }
      }
      return; // Don't send to the agent itself
    }

    // Normal message: send to agent, then check response for dispatches
    try {
      const response = await agentManager.sendMessage(agentName, content);
      router.broadcastToAgent(agentName, {
        type: 'agent_message', agentName, role: 'assistant',
        content: response, timestamp: Date.now(),
      });
      await handleBridge(agentName, response);
    } catch (err) {
      router.broadcastToAgent(agentName, {
        type: 'agent_message', agentName, role: 'system',
        content: `Error: ${err}`, timestamp: Date.now(),
      });
    }
  });

  const shutdown = async (sig: string) => {
    console.log(`[ce-hub] ${sig}, shutting down...`);
    agentManager.shutdown();
    await app.close(); store.close(); process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: PORT, host: '0.0.0.0' });

  // Attach WebSocket to Fastify's HTTP server
  router.initialize(app.server);

  console.log(`[ce-hub] Ready on http://localhost:${PORT} (REST + WebSocket)`);
}

main().catch(e => { console.error('[ce-hub] Fatal:', e); process.exit(1); });
