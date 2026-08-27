import 'dotenv/config';
import { rawPgClient } from './src/db';

const TABLES = [
  'profiles',
  'hq_members',
  'notifications',
  'songs',
  'zone_songs',
  'subgroup_songs',
  'programs',
  'subgroup_programs',
  'zone_members',
  'subgroups',
  'subgroup_members',
  'schedule_programs',
  'upcoming_events',
  'submitted_songs',
];

async function rollback() {
  console.log('--- EMERGENCY ROLLBACK: Disabling RLS across all tables ---');
  for (const table of TABLES) {
    await rawPgClient.unsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    await rawPgClient.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${table}";`);
    console.log(`[${table}] RLS Disabled.`);
  }
  console.log('--- Rollback complete ---');
  process.exit(0);
}

rollback().catch((e) => {
  console.error(e);
  process.exit(1);
});
