import EventEmitter2pkg from 'eventemitter2';
const { EventEmitter2 } = EventEmitter2pkg as any;
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { StateStore } from './state-store.js';
import type http from 'node:http';

interface WsClient {
  id: string;
  ws: WebSocket;
  subscribedAgents: Set<string>;
}

export class MessageRouter {
  public emitter: EventEmitter2;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WsClient>();
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
    this.emitter = new EventEmitter2({ wildcard: true, delimiter: '.' });
  }

  initialize(server: http.Server): void {
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (ws) => {
      const client: WsClient = { id: uuidv4(), ws, subscribedAgents: new Set() };
      this.clients.set(client.id, client);
      console.log(`[MessageRouter] client connected: ${client.id}`);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleClientMessage(client, msg);
        } catch { this.sendTo(ws, { type: 'error', message: 'Invalid JSON' }); }
      });

      ws.on('close', () => { this.clients.delete(client.id); console.log(`[MessageRouter] client disconnected: ${client.id}`); });
      ws.on('error', (e) => console.error(`[MessageRouter] ws error:`, e));
    });
    console.log('[MessageRouter] WebSocket server initialized');
  }

  private handleClientMessage(client: WsClient, msg: { type: string; agentName?: string; content?: string }): void {
    switch (msg.type) {
      case 'ping': this.sendTo(client.ws, { type: 'pong' }); break;
      case 'subscribe': if (msg.agentName) { client.subscribedAgents.add(msg.agentName); this.sendTo(client.ws, { type: 'system', message: `Subscribed to ${msg.agentName}` }); } break;
      case 'unsubscribe': if (msg.agentName) { client.subscribedAgents.delete(msg.agentName); } break;
      case 'send_message':
        if (msg.agentName && msg.content) this.emitter.emit(`client.message.${msg.agentName}`, { agentName: msg.agentName, content: msg.content, clientId: client.id });
        break;
    }
  }

  emit(event: string, payload: unknown): void {
    this.emitter.emit(event, payload);
    try { this.store.createEvent({ type: event, source: 'message-router', payload: payload as Record<string, unknown> }); } catch {}
  }

  on(event: string, handler: (...args: unknown[]) => void): void { this.emitter.on(event, handler); }

  broadcastToAgent(agentName: string, message: Record<string, unknown>): void {
    const out = JSON.stringify({ ...message, agentName });
    for (const c of this.clients.values()) {
      if (c.subscribedAgents.has(agentName) && c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
    }
  }

  broadcastAll(message: Record<string, unknown>): void {
    const out = JSON.stringify(message);
    for (const c of this.clients.values()) { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(out); }
  }

  private sendTo(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
