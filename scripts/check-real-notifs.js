require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function checkRealNotifs() {
  const notifs = await sql`SELECT id, title, message, raw_data FROM notifications ORDER BY created_at DESC LIMIT 15`;
  for (const n of notifs) {
    console.log('ID:', n.id);
    console.log('SQL title:', n.title);
    console.log('SQL message:', n.message);
    console.log('RawData title:', n.raw_data?.title);
    console.log('RawData message:', n.raw_data?.message);
    console.log('RawData text/body:', n.raw_data?.body || n.raw_data?.text || n.raw_data?.content);
    console.log('RawData category:', n.raw_data?.category);
    console.log('---');
  }
  await sql.end();
}

checkRealNotifs().catch(console.error);
