import type { FastifyInstance } from 'fastify';
import type { Bus } from '../bus.js';
import type { Ledger } from '../ledger.js';

/** /ws — pushes { type: 'activity'|'pull'|'stats'|'machine', data } to every client. */
export async function registerWs(app: FastifyInstance, deps: { bus: Bus; ledger: Ledger }) {
  const clients = new Set<import('ws').WebSocket>();
  const unsub = deps.bus.subscribe((msg) => {
    const raw = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === 1) c.send(raw);
  });
  // Keepalive so idle sockets aren't dropped by Railway's edge proxy; also reaps dead peers.
  const alive = new WeakMap<import('ws').WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (alive.get(c) === false) {
        clients.delete(c);
        c.terminate();
        continue;
      }
      alive.set(c, false);
      c.ping();
    }
  }, 25_000);
  heartbeat.unref();
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    unsub();
    for (const c of clients) c.close();
  });

  app.get('/ws', { websocket: true }, async (socket) => {
    clients.add(socket);
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
    socket.on('message', (m: Buffer) => {
      if (m.toString() === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
    // Initial stats so clients render immediately.
    socket.send(JSON.stringify({ type: 'stats', data: await deps.ledger.stats() }));
  });
}
