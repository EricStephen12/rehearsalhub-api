import 'dotenv/config';
import { rawPgClient, baseDb } from './src/db';
import { sql } from 'drizzle-orm';

const TENANT_TABLES = [
  'profiles',
  'zone_members',
  'hq_members',
  'subgroups',
  'subgroup_members',
  'songs',
  'zone_songs',
  'subgroup_songs',
  'programs',
  'subgroup_programs',
  'submitted_songs',
  'attendance',
  'notifications',
  'upcoming_events',
];

async function verifyRls() {
  console.log('=== READ-ONLY RLS VERIFICATION ===');
  console.log('This script does not enable, disable, or modify any database policy.\n');

  const [database] = await rawPgClient`
    SELECT current_database() AS database,
           current_user AS role,
          COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
          COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypasses_rls;
  `;
  console.log('Database:', database.database);
  console.log('Role:', database.role);
  console.log('Superuser:', database.is_superuser);
  console.log('Bypasses RLS:', database.bypasses_rls);
  if (database.is_superuser || database.bypasses_rls) {
    console.log('WARNING: this role bypasses RLS, so row-count checks are not conclusive.');
  }

  const tableRows = await rawPgClient`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS force_rls,
           COALESCE(p.policy_count, 0)::int AS policy_count
    FROM pg_class c
    LEFT JOIN (
      SELECT polrelid, count(*) AS policy_count
      FROM pg_policy
      GROUP BY polrelid
    ) p ON p.polrelid = c.oid
    WHERE c.relname = ANY(${TENANT_TABLES})
    ORDER BY c.relname;
  `;

  console.log('\n=== TABLE STATUS ===');
  for (const table of TENANT_TABLES) {
    const row = tableRows.find((item: any) => item.table_name === table);
    if (!row) {
      console.log(`${table}: MISSING TABLE`);
      continue;
    }
    console.log(`${table}: RLS=${row.rls_enabled ? 'ON' : 'OFF'} FORCE=${row.force_rls ? 'ON' : 'OFF'} POLICIES=${row.policy_count}`);
  }

  const identityStatus = tableRows.filter((row: any) => row.table_name === 'profiles' || row.table_name === 'hq_members');
  const incompleteIdentity = identityStatus.filter((row: any) => !row.rls_enabled || !row.force_rls || row.policy_count === 0);
  if (incompleteIdentity.length > 0) {
    throw new Error(`Identity RLS is incomplete: ${incompleteIdentity.map((row: any) => `${row.table_name} (RLS=${row.rls_enabled ? 'ON' : 'OFF'}, FORCE=${row.force_rls ? 'ON' : 'OFF'}, POLICIES=${row.policy_count})`).join(', ')}`);
  }

  const policies = await rawPgClient`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = ANY(${TENANT_TABLES})
    ORDER BY tablename, policyname;
  `;

  console.log('\n=== POLICIES ===');
  if (policies.length === 0) {
    console.log('No policies found for the listed tables.');
  } else {
    for (const policy of policies) {
      console.log(`\n${policy.tablename}.${policy.policyname} [${policy.cmd}]`);
      console.log('USING:', policy.qual || '<none>');
      console.log('WITH CHECK:', policy.with_check || '<none>');
    }
  }

  const checkTables = ['songs', 'submitted_songs', 'attendance', 'notifications'];
  console.log('\n=== TENANT COUNT CHECKS ===');
  for (const tenantId of ['zone-001', 'zone-088']) {
    await baseDb.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.current_zone_id', ${tenantId}, true),
          set_config('app.current_church_id', '', true),
          set_config('app.is_hq', 'false', true);
      `);

      const [settings] = await tx.execute(sql`
        SELECT current_setting('app.current_zone_id', true) AS zone_id,
               current_setting('app.current_church_id', true) AS church_id,
               current_setting('app.is_hq', true) AS is_hq;
      `) as any;

      const counts: string[] = [];
      for (const table of checkTables) {
        const result = await tx.execute(sql.raw(`SELECT count(*)::int AS count FROM "${table}"`));
        counts.push(`${table}=${(result as any)[0]?.count ?? 'unknown'}`);
      }
      console.log(`${tenantId} settings: zone=${settings?.zone_id || '<empty>'}, church=${settings?.church_id || '<empty>'}, is_hq=${settings?.is_hq || '<empty>'}`);
      console.log(`${tenantId}: ${counts.join(', ')}`);
    });
  }

  await baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.current_zone_id', '', true),
        set_config('app.current_church_id', '', true),
        set_config('app.is_hq', 'true', true);
    `);

    const counts: string[] = [];
    for (const table of checkTables) {
      const result = await tx.execute(sql.raw(`SELECT count(*)::int AS count FROM "${table}"`));
      counts.push(`${table}=${(result as any)[0]?.count ?? 'unknown'}`);
    }
    console.log(`HQ: ${counts.join(', ')}`);
  });

  console.log('\n=== INTERPRETATION ===');
  console.log('Expected for tenant tables: RLS=ON and FORCE=ON.');
  console.log('Expected for non-HQ users: zone-001 and zone-088 counts contain only their own rows.');
  console.log('If Superuser=true, rerun using the application database role for conclusive RLS results.');
}

verifyRls()
  .catch((error) => {
    console.error('\nRLS verification failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
