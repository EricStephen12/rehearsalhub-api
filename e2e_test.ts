import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { signAccessToken } from './src/auth/token';
import { sql } from 'drizzle-orm';
import { zoneMembers, profiles } from './src/schema';

async function main() {
  console.log('=== PART 1: RAW PG_CLASS QUERY ===');
  const pgClassResults = await rawPgClient`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('songs','notifications','submitted_songs','zone_songs','subgroup_songs','programs','subgroup_programs','zone_members','subgroups','subgroup_members','schedule_programs','upcoming_events')
    ORDER BY relname;
  `;
  console.log(JSON.stringify(pgClassResults, null, 2));

  console.log('\n=== PART 2: FINDING TWO USERS FROM TWO DIFFERENT ZONES ===');
  const zMembers = await rawPgClient`
    SELECT zm.user_id, zm.zone_id, p.email, p.role
    FROM zone_members zm
    JOIN profiles p ON p.id = zm.user_id
    WHERE zm.zone_id NOT IN ('hq', 'global', 'zone-001')
    LIMIT 10;
  `;

  // Find two distinct zones
  const userA = zMembers[0];
  const userB = zMembers.find((u: any) => u.zone_id !== userA?.zone_id) || zMembers[1];

  console.log('User A:', userA);
  console.log('User B:', userB);

  // Generate tokens for each user
  const tokenA = signAccessToken({
    sub: userA.user_id,
    role: userA.role || 'member',
    zoneId: userA.zone_id,
  });

  const tokenB = signAccessToken({
    sub: userB.user_id,
    role: userB.role || 'member',
    zoneId: userB.zone_id,
  });

  console.log('\n=== PART 3: SIMULATING /zone-songs & /submitted-songs UNDER USER A TENANT TRANSACTION ===');
  // Run under User A's transaction context
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', ${userA.zone_id}, true),
        set_config('app.is_hq', 'false', true);
    `);
    const songsA = await tx.execute(sql`SELECT id, title, zone_id FROM zone_songs;`);
    const subsA = await tx.execute(sql`SELECT id, title, zone_id, user_id FROM submitted_songs;`);
    
    console.log(`\n--- USER A (${userA.email}, Zone: ${userA.zone_id}) ---`);
    console.log(`zone_songs count: ${(songsA as any).length}`);
    console.log(`zone_songs sample rows:`, (songsA as any).slice(0, 3));
    console.log(`submitted_songs count: ${(subsA as any).length}`);
    console.log(`submitted_songs sample rows:`, (subsA as any).slice(0, 3));
  });

  console.log('\n=== PART 4: SIMULATING /zone-songs & /submitted-songs UNDER USER B TENANT TRANSACTION ===');
  // Run under User B's transaction context
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', ${userB.zone_id}, true),
        set_config('app.is_hq', 'false', true);
    `);
    const songsB = await tx.execute(sql`SELECT id, title, zone_id FROM zone_songs;`);
    const subsB = await tx.execute(sql`SELECT id, title, zone_id, user_id FROM submitted_songs;`);
    
    console.log(`\n--- USER B (${userB.email}, Zone: ${userB.zone_id}) ---`);
    console.log(`zone_songs count: ${(songsB as any).length}`);
    console.log(`zone_songs sample rows:`, (songsB as any).slice(0, 3));
    console.log(`submitted_songs count: ${(subsB as any).length}`);
    console.log(`submitted_songs sample rows:`, (subsB as any).slice(0, 3));
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
