import 'dotenv/config';
import { db } from './src/db';
import { submittedSongs, attendance, songs } from './src/schema';
import { sql, eq } from 'drizzle-orm';
import { signAccessToken } from './src/auth/token';

async function testZonedQueries() {
  console.log('=== PART 1: RAW PG_CLASS QUERY ===');
  const pgClassResults = await db.execute(sql`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('songs','notifications','submitted_songs','zone_songs','subgroup_songs','programs','subgroup_programs','zone_members','subgroups','subgroup_members','schedule_programs','upcoming_events')
    ORDER BY relname;
  `);
  console.log(JSON.stringify(pgClassResults, null, 2));

  console.log('\n=== PART 2: END-TO-END TENANT ISOLATION QUERY TEST ===');

  // USER A: Zone 088
  console.log('\n--- User A: Zone 088 (zone-088) ---');
  const withoutHyphenA = 'zone088';
  const cleanZoneA = 'zone-088';

  const rowsSubA = await db.select().from(submittedSongs).where(
    sql`lower(replace(replace(${submittedSongs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphenA} OR 
        lower(${submittedSongs.zoneId}) = ${cleanZoneA} OR 
        lower(replace(replace(${submittedSongs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphenA} OR 
        lower(replace(replace(${submittedSongs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphenA}`
  );

  console.log(`User A (zone-088) submitted_songs count: ${rowsSubA.length}`);
  console.log('User A sample rows:', rowsSubA.slice(0, 3).map(r => ({
    id: r.id,
    title: r.title,
    zoneId: r.zoneId,
    rawDataZone: (r.rawData as any)?.zone_code || (r.rawData as any)?.zoneId
  })));

  // USER B: Zone 001
  console.log('\n--- User B: Zone 001 (zone-001) ---');
  const withoutHyphenB = 'zone001';
  const cleanZoneB = 'zone-001';

  const rowsSubB = await db.select().from(submittedSongs).where(
    sql`lower(replace(replace(${submittedSongs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphenB} OR 
        lower(${submittedSongs.zoneId}) = ${cleanZoneB} OR 
        lower(replace(replace(${submittedSongs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphenB} OR 
        lower(replace(replace(${submittedSongs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphenB}`
  );

  console.log(`User B (zone-001) submitted_songs count: ${rowsSubB.length}`);
  console.log('User B sample rows:', rowsSubB.slice(0, 3).map(r => ({
    id: r.id,
    title: r.title,
    zoneId: r.zoneId,
    rawDataZone: (r.rawData as any)?.zone_code || (r.rawData as any)?.zoneId
  })));

  // USER A vs USER B on Songs / Repertoire
  console.log('\n--- Songs isolation check (songs table) ---');
  const songsZoneA = await db.select().from(songs).where(eq(songs.zoneId, 'zone-088'));
  const songsZoneB = await db.select().from(songs).where(eq(songs.zoneId, 'zone-001'));
  console.log(`User A (zone-088) songs count: ${songsZoneA.length}`);
  console.log('User A songs sample:', songsZoneA.slice(0, 3).map(s => ({ id: s.id, title: s.title, zoneId: s.zoneId })));

  console.log(`User B (zone-001) songs count: ${songsZoneB.length}`);
  console.log('User B songs sample:', songsZoneB.slice(0, 3).map(s => ({ id: s.id, title: s.title, zoneId: s.zoneId })));

  process.exit(0);
}

testZonedQueries().catch(e => {
  console.error(e);
  process.exit(1);
});
