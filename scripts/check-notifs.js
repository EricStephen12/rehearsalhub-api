require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function checkNotifs() {
  const allNotifs = await sql`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10`;
  console.log(`Total notifications in DB: ${allNotifs.length}`);
  console.log(JSON.stringify(allNotifs, null, 2));
  await sql.end();
}

checkNotifs().catch(console.error);
