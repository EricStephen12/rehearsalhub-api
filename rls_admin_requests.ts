import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

async function step1AdminRequests() {
  console.log('=== STEP 1: CREATING admin_requests TABLE IF NOT EXISTS & ENABLING RLS ===');
  await rawPgClient`
    CREATE TABLE IF NOT EXISTS admin_requests (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      user_email text,
      user_name text,
      zone_id text,
      zone_code text,
      requested_role text DEFAULT 'zone_admin',
      status text DEFAULT 'pending',
      reason text,
      reviewed_by text,
      reviewed_at timestamp,
      created_at timestamp DEFAULT now(),
      updated_at timestamp,
      raw_data jsonb
    );
  `;
  await rawPgClient`ALTER TABLE admin_requests ENABLE ROW LEVEL SECURITY;`;
  await rawPgClient`ALTER TABLE admin_requests FORCE ROW LEVEL SECURITY;`;
  await rawPgClient`DROP POLICY IF EXISTS tenant_isolation ON admin_requests;`;
  await rawPgClient`
    CREATE POLICY tenant_isolation ON admin_requests
    FOR ALL
    USING (
      current_setting('app.is_hq', true) = 'true'
      OR zone_id = current_setting('app.current_zone_id', true)
      OR zone_code = current_setting('app.current_zone_id', true)
      OR lower(replace(replace(zone_code, '-', ''), ' ', '')) = lower(replace(replace(current_setting('app.current_zone_id', true), '-', ''), ' ', ''))
    );
  `;

  // Seed sample requests for testing
  await rawPgClient`
    INSERT INTO admin_requests (id, user_id, user_email, user_name, zone_id, zone_code, status)
    VALUES 
      ('req_088_1', 'user_088', 'user088@test.com', 'Singer 088', 'zone-088', 'zone-088', 'pending'),
      ('req_001_1', 'user_001', 'user001@test.com', 'Singer 001', 'zone-001', 'zone-001', 'pending')
    ON CONFLICT (id) DO NOTHING;
  `;

  console.log('\n=== STEP 2: PG_CLASS VERIFICATION FOR admin_requests ===');
  const pgClass = await rawPgClient`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = 'admin_requests';
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
    const rowsA = await tx.execute(sql`SELECT id, user_id, user_email, zone_id, zone_code, status FROM admin_requests;`);
    console.log(`admin_requests count for zone-088: ${(rowsA as any).length}`);
    console.log(`admin_requests sample rows:`, (rowsA as any).slice(0, 3));
  });

  // User B: zone-001
  console.log('\n--- User B (Zone: zone-001) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-001', true),
        set_config('app.is_hq', 'false', true);
    `);
    const rowsB = await tx.execute(sql`SELECT id, user_id, user_email, zone_id, zone_code, status FROM admin_requests;`);
    console.log(`admin_requests count for zone-001: ${(rowsB as any).length}`);
    console.log(`admin_requests sample rows:`, (rowsB as any).slice(0, 3));
  });

  // Superuser / HQ
  console.log('\n--- HQ Admin (Global / All Scope) ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', '', true),
        set_config('app.is_hq', 'true', true);
    `);
    const rowsHQ = await tx.execute(sql`SELECT id, zone_id, zone_code FROM admin_requests;`);
    console.log(`admin_requests total count for HQ:`, (rowsHQ as any).length);
    console.log(`admin_requests HQ sample rows:`, (rowsHQ as any).slice(0, 3));
  });

  process.exit(0);
}

step1AdminRequests().catch((e) => {
  console.error('ERROR in step1AdminRequests:', e);
  process.exit(1);
});
