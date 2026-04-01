import { spawn, type ChildProcess } from 'node:child_process';

const CWD = process.env.CE_HUB_CWD || process.cwd();
const BASE_PORT = 9100; // agent terminals: 9100, 9101, 9102...

interface TtydSession {
  proc: ChildProcess;
  agentName: string;
  port: number;
}

export class PtyManager {
  private sessions = new Map<string, TtydSession>();
  private nextPort = BASE_PORT;

  // Start a ttyd instance running claude for this agent
  startAgent(agentName: string): number {
    if (this.sessions.has(agentName)) return this.sessions.get(agentName)!.port;

    const port = this.nextPort++;
    console.log(`[PtyManager] starting ttyd for ${agentName} on port ${port}...`);

    const proc = spawn('ttyd', [
      '--port', String(port),
      '--writable',
      '--base-path', `/${agentName}`,
      'claude', '--model', 'sonnet', '--dangerously-skip-permissions',
    ], {
      cwd: CWD,
      stdio: 'ignore',
      detached: false,
    });

    proc.on('exit', (code) => {
      console.log(`[PtyManager] ${agentName} ttyd exited (${code})`);
      this.sessions.delete(agentName);
    });

    this.sessions.set(agentName, { proc, agentName, port });
    return port;
  }

  getPort(agentName: string): number | null {
    return this.sessions.get(agentName)?.port ?? null;
  }

  listSessions(): { agentName: string; port: number }[] {
    return [...this.sessions.values()].map(s => ({ agentName: s.agentName, port: s.port }));
  }

  shutdown(): void {
    for (const [name, session] of this.sessions) {
      console.log(`[PtyManager] killing ttyd ${name}`);
      session.proc.kill();
    }
    this.sessions.clear();
  }
}
