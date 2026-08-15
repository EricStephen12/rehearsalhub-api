/**
 * Temporary Stage 3 checkpoint smoke test — delete after run.
 * Creates one test chat, verifies WS broadcasts end-to-end, then deletes it.
 */
import 'dotenv/config';
import WebSocket from 'ws';
import { signAccessToken } from './src/auth/token';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const WS_BASE = BASE.replace('http', 'ws');
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const h = await fetch(`${BASE}/health`);
  ok('GET /health -> 200', h.status === 200);

  const login = (body: unknown) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const l = await login({ email: 'nobody@example.com', password: 'wrongpass1' });
  const lb = (await l.json()) as { error?: string };
  ok('bad login -> 401 generic', l.status === 401 && typeof lb.error === 'string' && !/email|password/i.test(lb.error), `error="${lb.error}"`);

  const me = await fetch(`${BASE}/auth/me`);
  ok('GET /auth/me no token -> 401', me.status === 401);

  const ms = await fetch(`${BASE}/api/master-songs`, { headers: { 'x-api-key': process.env.API_SECRET_KEY ?? '' } });
  ok('GET /api/master-songs with x-api-key -> 200', ms.status === 200);

  let got429 = false;
  for (let i = 0; i < 11; i++) {
    const r = await login({ email: 'nobody@example.com', password: 'wrongpass1' });
    if (r.status === 429) { got429 = true; break; }
  }
  ok('11th rapid login -> 429', got429);

  // ── WebSocket end-to-end ──
  const userA = `smoke-a-${Date.now()}`;
  const userB = `smoke-b-${Date.now()}`;
  const tokenA = signAccessToken({ sub: userA, role: 'member' });
  const tokenB = signAccessToken({ sub: userB, role: 'member' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const authB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` };

  const cc = await fetch(`${BASE}/chats`, {
    method: 'POST', headers: authA,
    body: JSON.stringify({ type: 'group', name: 'smoke test chat', member_ids: [userA] }),
  });
  const chat = ((await cc.json()) as { data?: { id: string } }).data;
  ok('POST /chats -> 201', cc.status === 201 && !!chat?.id);
  if (!chat?.id) throw new Error('chat create failed, aborting');

  const events: Array<{ type: string; resource?: string; data?: Record<string, unknown> }> = [];
  const ws = new WebSocket(`${WS_BASE}/ws?token=${tokenA}`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ type: 'subscribe', resource: 'chat', id: chat.id }));
  ws.send(JSON.stringify({ type: 'subscribe', resource: 'messages', id: chat.id }));
  await wait(500);
  ok('subscribe acks received', events.filter((e) => e.type === 'subscribed').length === 2);

  const pc = await fetch(`${BASE}/chats/${chat.id}`, {
    method: 'PATCH', headers: authA, body: JSON.stringify({ name: 'renamed by smoke' }),
  });
  ok('PATCH /chats/:id as member -> 200', pc.status === 200);
  await wait(500);
  ok('chat event broadcast on PATCH', events.some((e) => e.type === 'event' && e.resource === 'chat' && e.data?.name === 'renamed by smoke'));

  const sm = await fetch(`${BASE}/chats/${chat.id}/messages`, {
    method: 'POST', headers: authA, body: JSON.stringify({ content: 'hello smoke' }),
  });
  ok('POST message as member -> 201', sm.status === 201);
  await wait(500);
  ok('messages event broadcast', events.some((e) => e.type === 'event' && e.resource === 'messages' && e.data?.content === 'hello smoke'));
  ok('chat metadata event broadcast (lastMessage)', events.some((e) => e.type === 'event' && e.resource === 'chat' && e.data?.lastMessage === 'hello smoke'));

  const before = events.length;
  const nb = await fetch(`${BASE}/chats/${chat.id}/messages`, {
    method: 'POST', headers: authB, body: JSON.stringify({ content: 'intruder' }),
  });
  ok('POST message as non-member -> 403', nb.status === 403);
  const np = await fetch(`${BASE}/chats/${chat.id}`, {
    method: 'PATCH', headers: authB, body: JSON.stringify({ name: 'hacked' }),
  });
  ok('PATCH chat as non-member -> 403', np.status === 403);
  await wait(500);
  ok('no events emitted for forbidden writes', events.length === before);

  const wsBad = new WebSocket(`${WS_BASE}/ws?token=garbage`);
  const badClosed = await new Promise<boolean>((res) => {
    wsBad.on('close', (code) => res(code === 1008));
    wsBad.on('error', () => undefined);
    setTimeout(() => res(false), 3000);
  });
  ok('WS handshake rejects bad token (1008)', badClosed);

  ws.close();

  const { db } = await import('./src/db');
  const { chatsV2, messagesV2 } = await import('./src/schema');
  const { eq } = await import('drizzle-orm');
  await db.delete(messagesV2).where(eq(messagesV2.chatId, chat.id));
  await db.delete(chatsV2).where(eq(chatsV2.id, chat.id));
  results.push('cleanup: smoke-test chat and messages deleted from DB');

  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE ERROR:', e); console.log(results.join('\n')); process.exit(1); });
