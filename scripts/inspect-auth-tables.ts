import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  for (const table of ['auth_credentials', 'refresh_tokens', 'users']) {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `;
    const count = await sql.unsafe(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}'`,
    );
    console.log(`\n=== ${table} (exists check rows=${count[0]?.c}) ===`);
    if (cols.length === 0) {
      console.log('(missing)');
    } else {
      console.log(cols);
      const rowCount = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${table}`);
      console.log('row count:', rowCount[0]?.c);
    }
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
