require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  console.log('=== Checking all zone memberships in zone_members and hq_members ===');
  const zm = await sql`SELECT zone_id, count(*) as count FROM zone_members GROUP BY zone_id ORDER BY count DESC LIMIT 15`;
  console.log('Top zone_members by zone:', JSON.stringify(zm, null, 2));

  const hm = await sql`SELECT hq_group_id, count(*) as count FROM hq_members GROUP BY hq_group_id ORDER BY count DESC LIMIT 15`;
  console.log('Top hq_members by group:', JSON.stringify(hm, null, 2));

  await sql.end();
}

run().catch(console.error);
