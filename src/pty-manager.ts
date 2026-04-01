import * as pty from 'node-pty';
import { WebSocket } from 'ws';

const CWD = process.env.CE_HUB_CWD || process.cwd();
const SHELL = process.env.SHELL || '/bin/zsh';

interface PtySession {
  term: pty.IPty;
  clients: Set<WebSocket>;
  agentName: string;
  started: boolean; // has claude been started?
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

  // Get or create a PTY for an agent
  getOrCreate(agentName: string): PtySession {
    let session = this.sessions.get(agentName);
    if (session && !session.term.killed) return session;

    console.log(`[PtyManager] creating PTY for ${agentName}...`);

    const term = pty.spawn(SHELL, ['-l'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: CWD,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    session = { term, clients: new Set(), agentName, started: false };

    // Relay PTY output to all connected WebSocket clients
    term.onData((data: string) => {
      for (const ws of session!.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pty_output', agentName, data }));
        }
      }
    });

    term.onExit(({ exitCode }) => {
      console.log(`[PtyManager] ${agentName} PTY exited (${exitCode})`);
      this.sessions.delete(agentName);
      for (const ws of session!.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pty_exit', agentName, exitCode }));
        }
      }
    });

    this.sessions.set(agentName, session);
    return session;
  }

  // Start claude in this PTY (only once)
  startClaude(agentName: string): void {
    const session = this.getOrCreate(agentName);
    if (session.started) return;
    session.started = true;
    // Launch claude with the agent's working directory
    session.term.write(`claude --model sonnet --dangerously-skip-permissions\r`);
  }

  // Send input to PTY (keyboard input from frontend)
  write(agentName: string, data: string): void {
    const session = this.sessions.get(agentName);
    if (session && !session.term.killed) {
      session.term.write(data);
    }
  }

  // Resize PTY
  resize(agentName: string, cols: number, rows: number): void {
    const session = this.sessions.get(agentName);
    if (session && !session.term.killed) {
      session.term.resize(cols, rows);
    }
  }

  // Attach WebSocket client to receive PTY output
  attach(agentName: string, ws: WebSocket): void {
    const session = this.getOrCreate(agentName);
    session.clients.add(ws);
    ws.on('close', () => session.clients.delete(ws));
  }

  // Detach client
  detach(agentName: string, ws: WebSocket): void {
    const session = this.sessions.get(agentName);
    if (session) session.clients.delete(ws);
  }

  listSessions(): { agentName: string; alive: boolean; started: boolean }[] {
    return [...this.sessions.values()].map(s => ({
      agentName: s.agentName,
      alive: !s.term.killed,
      started: s.started,
    }));
  }

  shutdown(): void {
    for (const [name, session] of this.sessions) {
      console.log(`[PtyManager] killing ${name}`);
      session.term.kill();
    }
    this.sessions.clear();
  }
}
