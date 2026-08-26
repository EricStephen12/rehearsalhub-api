import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

const TABLES_TO_FORCE = [
  'songs',
  'notifications',
  'submitted_songs',
  'zone_songs',
  'subgroup_songs',
  'programs',
  'subgroup_programs',
  'zone_members',
  'subgroups',
  'subgroup_members',
  'schedule_programs',
  'upcoming_events',
];

async function main() {
  console.log('--- ENABLING FORCE ROW LEVEL SECURITY & STRICT POLICIES ---');

  for (const table of TABLES_TO_FORCE) {
    await rawPgClient.unsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    await rawPgClient.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${table}";`);

    if (table === 'subgroup_members') {
      await rawPgClient.unsafe(`
        CREATE POLICY tenant_isolation ON "${table}"
        FOR ALL
        USING (
          current_setting('app.is_hq', true) = 'true'
          OR subgroup_id = current_setting('app.current_church_id', true)
        );
      `);
    } else {
      await rawPgClient.unsafe(`
        CREATE POLICY tenant_isolation ON "${table}"
        FOR ALL
        USING (
          current_setting('app.is_hq', true) = 'true'
          OR zone_id = current_setting('app.current_zone_id', true)
        );
      `);
    }
  }

  console.log('--- Checking pg_class ---');
  const pgClass = await rawPgClient`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('songs','notifications','submitted_songs','zone_songs','subgroup_songs','programs','subgroup_programs','zone_members','subgroups','subgroup_members','schedule_programs','upcoming_events')
    ORDER BY relname;
  `;
  console.log(JSON.stringify(pgClass, null, 2));

  console.log('\n--- TESTING NON-HQ USER A (Zone: zone-088) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-088', true),
        set_config('app.is_hq', 'false', true);
    `);
    const songsA = await tx.execute(sql`SELECT id, title, zone_id FROM zone_songs;`);
    const subsA = await tx.execute(sql`SELECT id, title, zone_id FROM submitted_songs;`);
    console.log(`zone_songs count for zone-088: ${(songsA as any).length}`);
    console.log(`zone_songs sample rows:`, (songsA as any).slice(0, 3));
    console.log(`submitted_songs count for zone-088: ${(subsA as any).length}`);
    console.log(`submitted_songs sample rows:`, (subsA as any).slice(0, 3));
  });

  console.log('\n--- TESTING NON-HQ USER B (Zone: zone-001) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-001', true),
        set_config('app.is_hq', 'false', true);
    `);
    const songsB = await tx.execute(sql`SELECT id, title, zone_id FROM zone_songs;`);
    const subsB = await tx.execute(sql`SELECT id, title, zone_id FROM submitted_songs;`);
    console.log(`zone_songs count for zone-001: ${(songsB as any).length}`);
    console.log(`zone_songs sample rows:`, (songsB as any).slice(0, 3));
    console.log(`submitted_songs count for zone-001: ${(subsB as any).length}`);
    console.log(`submitted_songs sample rows:`, (subsB as any).slice(0, 3));
  });

  console.log('\n--- TESTING HQ ADMIN (Global / All Scope) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', '', true),
        set_config('app.is_hq', 'true', true);
    `);
    const songsHQ = await tx.execute(sql`SELECT count(*) FROM zone_songs;`);
    const subsHQ = await tx.execute(sql`SELECT count(*) FROM submitted_songs;`);
    console.log(`zone_songs total count for HQ: ${(songsHQ as any)[0].count}`);
    console.log(`submitted_songs total count for HQ: ${(subsHQ as any)[0].count}`);
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
