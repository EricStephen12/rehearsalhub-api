require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function run() {
  for (const t of ['calendar_events', 'upcoming_events', 'countdowns', 'programs', 'schedule_programs']) {
    try {
      const c = await sql.unsafe(`SELECT count(*) FROM "${t}"`);
      console.log(`=== ${t} (${c[0].count} rows) ===`);
      const s = await sql.unsafe(`SELECT * FROM "${t}" LIMIT 5`);
      console.log(JSON.stringify(s, null, 2));
    } catch (e) {
      console.log(t, e.message);
    }
  }
  await sql.end();
}
run().catch(console.error);
