/**
 * Temporary WS protocol test (no DB required) — delete after run.
 */
import WebSocket from 'ws';
import { signAccessToken } from './src/auth/token';

const WS_BASE = `ws://localhost:${process.env.PORT || 3010}`;
const results: string[] = [];
const ok = (name: string, pass: boolean) => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const token = signAccessToken({ sub: 'ws-proto-test-user', role: 'member' });
  const events: Array<{ type: string; resource?: string }> = [];

  const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
  const opened = await new Promise<boolean>((res) => {
    ws.on('open', () => res(true));
    ws.on('error', () => res(false));
    setTimeout(() => res(false), 5000);
  });
  ok('WS connects with valid JWT', opened);
  if (!opened) throw new Error('connect failed');

  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ type: 'subscribe', resource: 'profile', id: 'u1' }));
  ws.send(JSON.stringify({ type: 'subscribe', resource: 'profile', id: 'u1' })); // duplicate
  ws.send(JSON.stringify({ type: 'ping' }));
  await wait(500);

  ok('subscribe acknowledged', events.some((e) => e.type === 'subscribed'));
  ok('duplicate subscribe acknowledged without error', events.filter((e) => e.type === 'subscribed').length === 2 && !events.some((e) => e.type === 'error'));
  ok('ping -> pong', events.some((e) => e.type === 'pong'));

  const wsBad = new WebSocket(`${WS_BASE}/ws?token=garbage`);
  const badClosed = await new Promise<boolean>((res) => {
    wsBad.on('close', (code) => res(code === 1008));
    wsBad.on('error', () => undefined);
    setTimeout(() => res(false), 3000);
  });
  ok('bad token rejected with close code 1008', badClosed);

  const wsNone = new WebSocket(`${WS_BASE}/ws`);
  const noneClosed = await new Promise<boolean>((res) => {
    wsNone.on('close', (code) => res(code === 1008));
    wsNone.on('error', () => undefined);
    setTimeout(() => res(false), 3000);
  });
  ok('missing token rejected with close code 1008', noneClosed);

  ws.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}

main().catch((e) => { console.error('WS TEST ERROR:', e); console.log(results.join('\n')); process.exit(1); });
