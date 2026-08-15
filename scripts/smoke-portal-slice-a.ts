/**
 * Smoke Portal Slice A — static + live collection reads (no JWT refresh insert).
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { asc } from 'drizzle-orm';

async function main(): Promise<void> {
  const portalApi = join(
    'C:\\Users\\Eric\\Pictures\\workholiday\\clones\\Loveworld-Singers-Rehearsal-Hub-Portal-Zonal-Mode',
    'src/lib/api-client.ts',
  );
  const src = readFileSync(portalApi, 'utf8');
  const checks = [
    ['export BackendAPI', src.includes('export const BackendAPI')],
    ['profiles directory', src.includes('/profiles/directory')],
    ['members hq', src.includes('/members/hq')],
    ['members by-user', src.includes('/members/by-user/')],
    ['songs master', src.includes('/songs/master')],
    ['subgroups mine', src.includes('/subgroups/mine')],
    ['chats list', src.includes("chats: '/chats'") || src.includes('chats: "/chats"')],
    ['activity-logs', src.includes('/activity-logs')],
    ['favorites me', src.includes('/favorites/me')],
    ['playlists me', src.includes('/playlists/me')],
  ] as const;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'OK' : 'FAIL'} ${name}`);
    if (!ok) throw new Error(`Missing: ${name}`);
  }

  const { db } = await import('../src/db');
  const {
    profiles,
    hqMembers,
    praiseNights,
    categories,
    schedulePrograms,
    masterSongs,
  } = await import('../src/schema');

  const [p, h, n, c, s, m] = await Promise.all([
    db.select({ id: profiles.id }).from(profiles).limit(3),
    db.select({ id: hqMembers.id }).from(hqMembers).limit(3),
    db.select({ id: praiseNights.id }).from(praiseNights).limit(3),
    db.select().from(categories).limit(3),
    db.select({ id: schedulePrograms.id }).from(schedulePrograms).limit(3),
    db.select({ id: masterSongs.id }).from(masterSongs).orderBy(asc(masterSongs.title)).limit(3),
  ]);

  console.log('live counts sample:', {
    profiles: p.length,
    hq: h.length,
    praiseNights: n.length,
    categories: c.length,
    schedule: s.length,
    master: m.length,
  });

  if (![p, h, n, c, s, m].every((x) => x.length > 0)) {
    throw new Error('Unexpected empty live sample');
  }

  console.log('PORTAL SLICE A SMOKE PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
