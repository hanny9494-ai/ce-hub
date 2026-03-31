import type { AgentManager } from './agent-manager.js';
import type { MessageRouter } from './message-router.js';

/**
 * Bridge: intercepts agent responses for dispatch commands.
 *
 * When any agent (especially cc-lead) outputs a line like:
 *   @coder: write a script to download X
 *   @researcher: find papers about Y
 *
 * The bridge:
 * 1. Detects the @agent pattern
 * 2. Sends the message to the target agent
 * 3. Shows the dispatch in both agent tiles
 * 4. Returns the result to the originating agent
 */

const DISPATCH_PATTERN = /@(\w[\w-]*)\s*[：:]\s*(.+)/g;

interface DispatchCommand {
  targetAgent: string;
  message: string;
}

export function parseDispatches(text: string): DispatchCommand[] {
  const cmds: DispatchCommand[] = [];
  let match;
  const re = new RegExp(DISPATCH_PATTERN.source, 'gm');
  while ((match = re.exec(text)) !== null) {
    cmds.push({ targetAgent: match[1], message: match[2].trim() });
  }
  return cmds;
}

export function setupBridge(agentManager: AgentManager, router: MessageRouter) {
  // After an agent responds, check if the response contains dispatch commands
  // This is called from index.ts after getting agent response

  return async function handleAgentResponse(
    fromAgent: string,
    response: string,
  ): Promise<void> {
    const dispatches = parseDispatches(response);
    if (dispatches.length === 0) return;

    for (const { targetAgent, message } of dispatches) {
      console.log(`[bridge] ${fromAgent} → @${targetAgent}: ${message.slice(0, 60)}`);

      // Show dispatch in target agent's tile
      router.broadcastToAgent(targetAgent, {
        type: 'agent_message', agentName: targetAgent, role: 'system',
        content: `[from ${fromAgent}] ${message}`,
        timestamp: Date.now(),
      });

      // Execute on target agent
      try {
        const result = await agentManager.sendMessage(targetAgent, message);

        // Show result in target agent's tile
        router.broadcastToAgent(targetAgent, {
          type: 'agent_message', agentName: targetAgent, role: 'assistant',
          content: result, timestamp: Date.now(),
        });

        // Notify originating agent of the result
        router.broadcastToAgent(fromAgent, {
          type: 'agent_message', agentName: fromAgent, role: 'system',
          content: `[${targetAgent} completed] ${result.slice(0, 500)}`,
          timestamp: Date.now(),
        });

        // Also send result back into originating agent's conversation
        // so it has context for follow-up
        await agentManager.sendMessage(fromAgent,
          `[Result from ${targetAgent}]: ${result.slice(0, 1000)}`
        ).then(followUp => {
          if (followUp) {
            router.broadcastToAgent(fromAgent, {
              type: 'agent_message', agentName: fromAgent, role: 'assistant',
              content: followUp, timestamp: Date.now(),
            });
          }
        }).catch(() => {});

      } catch (err) {
        router.broadcastToAgent(targetAgent, {
          type: 'agent_message', agentName: targetAgent, role: 'system',
          content: `Error: ${err}`, timestamp: Date.now(),
        });
        router.broadcastToAgent(fromAgent, {
          type: 'agent_message', agentName: fromAgent, role: 'system',
          content: `[@${targetAgent} failed] ${err}`, timestamp: Date.now(),
        });
      }
    }
  };
}
