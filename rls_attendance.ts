import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

async function step3Attendance() {
  console.log('=== STEP 1: ENABLING RLS ON attendance ===');
  await rawPgClient`ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;`;
  await rawPgClient`ALTER TABLE attendance FORCE ROW LEVEL SECURITY;`;
  await rawPgClient`DROP POLICY IF EXISTS tenant_isolation ON attendance;`;
  await rawPgClient`
    CREATE POLICY tenant_isolation ON attendance
    FOR ALL
    USING (
      current_setting('app.is_hq', true) = 'true'
      OR zone_id = current_setting('app.current_zone_id', true)
      OR (raw_data->>'zoneId' IS NOT NULL AND raw_data->>'zoneId' = current_setting('app.current_zone_id', true))
      OR (raw_data->>'zone_id' IS NOT NULL AND raw_data->>'zone_id' = current_setting('app.current_zone_id', true))
      OR (raw_data->>'subGroupId' IS NOT NULL AND raw_data->>'subGroupId' = current_setting('app.current_church_id', true))
      OR (raw_data->>'sub_group_id' IS NOT NULL AND raw_data->>'sub_group_id' = current_setting('app.current_church_id', true))
    );
  `;

  console.log('\n=== STEP 2: PG_CLASS VERIFICATION FOR attendance ===');
  const pgClass = await rawPgClient`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = 'attendance';
  `;
  console.log(JSON.stringify(pgClass, null, 2));

  console.log('\n=== STEP 3: E2E QUERIES AS REAL NON-HQ USERS ===');

  // User A: zone-088
  console.log('--- User A (Zone: zone-088) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-088', true),
        set_config('app.is_hq', 'false', true);
    `);
    const rowsA = await tx.execute(sql`SELECT id, user_name, zone_id, event_name FROM attendance;`);
    console.log(`attendance count for zone-088: ${(rowsA as any).length}`);
    console.log(`attendance sample rows:`, (rowsA as any).slice(0, 3));
  });

  // User B: zone-001
  console.log('\n--- User B (Zone: zone-001) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-001', true),
        set_config('app.is_hq', 'false', true);
    `);
    const rowsB = await tx.execute(sql`SELECT id, user_name, zone_id, event_name FROM attendance;`);
    console.log(`attendance count for zone-001: ${(rowsB as any).length}`);
    console.log(`attendance sample rows:`, (rowsB as any).slice(0, 3));
  });

  // HQ Admin
  console.log('\n--- HQ Admin (Global / All Scope) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', '', true),
        set_config('app.is_hq', 'true', true);
    `);
    const rowsHQ = await tx.execute(sql`SELECT count(*) FROM attendance;`);
    console.log(`attendance total count for HQ:`, (rowsHQ as any)[0]?.count);
  });

  process.exit(0);
}

step3Attendance().catch((e) => {
  console.error('ERROR in step3Attendance:', e);
  process.exit(1);
});
