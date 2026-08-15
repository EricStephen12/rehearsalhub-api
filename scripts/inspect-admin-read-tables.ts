/**
 * Inspect live columns for Admin read collections.
 */
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main(): Promise<void> {
  const tables = [
    'activity_logs',
    'categories',
    'praise_nights',
    'schedule',
    'schedule_programs',
    'submitted_songs',
    'master_songs',
  ];
  for (const table of tables) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${table}
      ORDER BY ordinal_position
    `;
    if (cols.length === 0) {
      console.log(`\n${table}: MISSING`);
      continue;
    }
    const count = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${table}`);
    console.log(`\n${table} (${count[0].c} rows):`, cols.map((c) => c.column_name).join(', '));
    const sample = await sql.unsafe(`SELECT * FROM ${table} LIMIT 1`);
    if (sample[0]) {
      const keys = Object.keys(sample[0]);
      const raw = sample[0].raw_data;
      console.log('  sample keys:', keys.join(', '));
      if (raw && typeof raw === 'object') {
        console.log('  raw_data keys:', Object.keys(raw as object).slice(0, 20).join(', '));
      }
    }
  }
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
