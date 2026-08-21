require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  const p = await sql`SELECT id, name, category, status, zone_id, date FROM programs LIMIT 10`;
  console.log('Programs:', JSON.stringify(p, null, 2));

  const s = await sql`SELECT id, title, praise_night_id, zone_id, category FROM songs LIMIT 10`;
  console.log('Sample Songs:', JSON.stringify(s, null, 2));

  await sql.end();
}

run().catch(console.error);
