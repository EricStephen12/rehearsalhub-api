require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function run() {
  const c = await sql`SELECT count(*) FROM upcoming_events`;
  console.log('Total upcoming_events count:', c[0].count);
  const all = await sql`SELECT * FROM upcoming_events ORDER BY date DESC`;
  console.log('All upcoming_events:\n', JSON.stringify(all, null, 2));
  await sql.end();
}
run().catch(console.error);
