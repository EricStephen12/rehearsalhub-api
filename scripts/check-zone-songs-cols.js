require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'zone_songs'
  `;
  console.log('zone_songs columns:', cols);

  const sample = await sql`SELECT * FROM zone_songs LIMIT 5`;
  console.log('zone_songs sample:', JSON.stringify(sample, null, 2));

  await sql.end();
}

run().catch(console.error);
