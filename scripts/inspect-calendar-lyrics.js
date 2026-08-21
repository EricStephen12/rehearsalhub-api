require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function main() {
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
  console.log('ALL TABLES IN DB:', tables.map(r => r.table_name).sort());

  for (const t of tables.map(r => r.table_name)) {
    if (t.includes('event') || t.includes('cal') || t.includes('sched') || t.includes('lyric') || t.includes('song') || t.includes('karaoke') || t.includes('page') || t.includes('setting')) {
      try {
        const countRes = await sql.unsafe(`SELECT count(*) FROM "${t}"`);
        console.log(`\n--- TABLE: "${t}" (${countRes[0].count} rows) ---`);
        const sample = await sql.unsafe(`SELECT * FROM "${t}" LIMIT 2`);
        console.log(`Sample:`, JSON.stringify(sample, null, 2));
      } catch (e) {
        console.error(`Error querying ${t}:`, e.message);
      }
    }
  }

  await sql.end();
}

main().catch(console.error);
