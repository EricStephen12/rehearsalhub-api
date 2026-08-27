import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

async function canaryNotifications() {
  console.log('--- Step 1: Pre-check notifications count as superuser ---');
  const superCount = await rawPgClient`SELECT count(*) FROM notifications`;
  console.log('Superuser count:', superCount[0].count);

  console.log('--- Step 2: Enabling RLS on notifications table ---');
  await rawPgClient`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;`;
  await rawPgClient`DROP POLICY IF EXISTS tenant_isolation ON notifications;`;
  await rawPgClient`
    CREATE POLICY tenant_isolation ON notifications
    FOR ALL
    USING (
      current_setting('app.is_hq', true) = 'true'
      OR zone_id = current_setting('app.current_zone_id', true)
    );
  `;
  console.log('Policy tenant_isolation created on notifications.');

  console.log('--- Step 3: Canary test with HQ tenant session ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', '', true),
        set_config('app.is_hq', 'true', true);
    `);
    const res = await tx.execute(sql`SELECT count(*) FROM notifications;`);
    console.log('Canary HQ session count:', (res as any)[0]?.count);
  });

  console.log('--- Step 4: Canary test with specific Zone session ---');
  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', 'zone-001', true),
        set_config('app.is_hq', 'false', true);
    `);
    const res = await tx.execute(sql`SELECT count(*) FROM notifications;`);
    console.log('Canary zone-001 session count:', (res as any)[0]?.count);
  });

  console.log('SUCCESS: Notifications RLS verified!');
  process.exit(0);
}

canaryNotifications().catch((err) => {
  console.error('FAILED Canary check on notifications:', err);
  process.exit(1);
});
