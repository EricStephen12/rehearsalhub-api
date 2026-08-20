import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { verifyAccessToken } from '../auth/token';
import { revocationStore } from '../auth/revocation';

type SubscriptionKey = `${string}:${string}`;

interface AuthenticatedSocket extends WebSocket {
  connectionId: string;
  userId: string;
}

const subscriptions = new Map<string, Set<SubscriptionKey>>();
const connections = new Map<string, AuthenticatedSocket>();

let wss: WebSocketServer | null = null;

// ── Broadcast an event to all subscribers of a resource ──────────────────────
export function broadcast(resource: string, id: string, data: unknown): void {
  const key: SubscriptionKey = `${resource}:${id}`;

  for (const [connId, subs] of subscriptions) {
    if (!subs.has(key)) continue;
    const socket = connections.get(connId);
    if (!socket || socket.readyState !== WebSocket.OPEN) continue;

    socket.send(JSON.stringify({ type: 'event', resource, id, data }));
  }
}

// ── Create and attach the WebSocket server ────────────────────────────────────
export function createWsServer(httpServer: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (rawSocket, req) => {
    // Authenticate via ?token= query param
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      rawSocket.close(1008, 'Missing token');
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
      if (revocationStore.isRevoked(payload.jti)) {
        rawSocket.close(1008, 'Unauthorized');
        return;
      }
    } catch {
      rawSocket.close(1008, 'Unauthorized');
      return;
    }

    const socket = rawSocket as AuthenticatedSocket;
    socket.connectionId = crypto.randomUUID();
    socket.userId = payload.sub;

    connections.set(socket.connectionId, socket);
    subscriptions.set(socket.connectionId, new Set());

    socket.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      const connSubs = subscriptions.get(socket.connectionId)!;

      if (msg.type === 'subscribe' && typeof msg.resource === 'string' && typeof msg.id === 'string') {
        const key: SubscriptionKey = `${msg.resource}:${msg.id}`;
        connSubs.add(key); // Set deduplicates automatically
        socket.send(JSON.stringify({ type: 'subscribed', resource: msg.resource, id: msg.id }));
        return;
      }

      if (msg.type === 'unsubscribe' && typeof msg.resource === 'string' && typeof msg.id === 'string') {
        const key: SubscriptionKey = `${msg.resource}:${msg.id}`;
        connSubs.delete(key);
        return;
      }

      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    });

    socket.on('close', () => {
      subscriptions.delete(socket.connectionId);
      connections.delete(socket.connectionId);
    });

    socket.on('error', () => {
      subscriptions.delete(socket.connectionId);
      connections.delete(socket.connectionId);
    });
  });

  // 25-second heartbeat to keep WebSocket tunnels active through Cloudflare and mobile proxies
  const heartbeatInterval = setInterval(() => {
    for (const [_, socket] of connections) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}
