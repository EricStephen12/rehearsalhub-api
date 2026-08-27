import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

const TABLES_TO_SECURE = [
  { table: 'songs', zoneCol: 'zone_id' },
  { table: 'zone_songs', zoneCol: 'zone_id' },
  { table: 'subgroup_songs', zoneCol: 'zone_id' },
  { table: 'programs', zoneCol: 'zone_id' },
  { table: 'subgroup_programs', zoneCol: 'zone_id' },
  { table: 'zone_members', zoneCol: 'zone_id' },
  { table: 'subgroups', zoneCol: 'zone_id' },
  { table: 'subgroup_members', zoneCol: null, subgroupIdCol: 'subgroup_id' },
  { table: 'schedule_programs', zoneCol: 'zone_id' },
  { table: 'upcoming_events', zoneCol: 'zone_id' },
  { table: 'submitted_songs', zoneCol: 'zone_id' },
];

async function runStepByStepRLS() {
  for (const { table, zoneCol, subgroupIdCol } of TABLES_TO_SECURE) {
    console.log(`\n========================================`);
    console.log(`Securing Table: [${table}]`);
    console.log(`========================================`);

    // 1. Pre-check superuser count
    const [preCount] = await rawPgClient.unsafe(`SELECT count(*) FROM "${table}"`);
    console.log(`[${table}] Superuser row count: ${preCount.count}`);

    // 2. Enable RLS and drop existing policy
    await rawPgClient.unsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    await rawPgClient.unsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    await rawPgClient.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${table}";`);

    // 3. Create Tenant Isolation Policy
    if (zoneCol) {
      await rawPgClient.unsafe(`
        CREATE POLICY tenant_isolation ON "${table}"
        FOR ALL
        USING (
          current_setting('app.is_hq', true) = 'true'
          OR "${zoneCol}" = current_setting('app.current_zone_id', true)
        );
      `);
    } else if (subgroupIdCol) {
      await rawPgClient.unsafe(`
        CREATE POLICY tenant_isolation ON "${table}"
        FOR ALL
        USING (
          current_setting('app.is_hq', true) = 'true'
          OR "${subgroupIdCol}" = current_setting('app.current_church_id', true)
        );
      `);
    }

    console.log(`[${table}] Policy created successfully.`);

    // 4. Canary check: HQ session must see all rows
    await baseDb.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 
          set_config('app.current_zone_id', '', true),
          set_config('app.is_hq', 'true', true);
      `);
      const res = await tx.execute(sql.raw(`SELECT count(*) FROM "${table}";`));
      const hqCount = (res as any)[0]?.count;
      console.log(`[${table}] Canary HQ session count: ${hqCount}`);
      if (Number(hqCount) !== Number(preCount.count)) {
        throw new Error(`[${table}] Canary check failed: HQ count (${hqCount}) != Superuser count (${preCount.count})`);
      }
    });

    console.log(`[${table}] ✅ VERIFIED & SECURED`);
  }

  console.log(`\n🎉 ALL TABLES VERIFIED WITH ROW-LEVEL SECURITY!`);
  process.exit(0);
}

runStepByStepRLS().catch(async (err) => {
  console.error('\n❌ ERROR DURING RLS ROLLOUT:', err);
  process.exit(1);
});
