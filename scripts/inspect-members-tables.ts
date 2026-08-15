import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main(): Promise<void> {
  for (const table of ['zone_members', 'hq_members']) {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `;
    console.log(`\n=== ${table} ===`);
    console.log(cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
    const sample = await sql.unsafe(`SELECT * FROM ${table} LIMIT 1`);
    console.log('sample keys:', sample[0] ? Object.keys(sample[0]) : '(empty)');
  }
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
