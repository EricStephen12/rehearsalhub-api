require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  console.log('=== CHECKING ZONE_SONGS FOR ZONE-088 & PROGRAM cMVkUCqdfEnIIIzGbhfR ===');
  const zs = await sql`
    SELECT id, title, praise_night_id, zone_id, category, raw_data 
    FROM zone_songs 
    WHERE zone_id = 'zone-088' OR praise_night_id = 'cMVkUCqdfEnIIIzGbhfR'
  `;
  console.log(`Found ${zs.length} in zone_songs:`, JSON.stringify(zs, null, 2));

  await sql.end();
}

run().catch(console.error);
