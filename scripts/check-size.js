require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function run() {
  const res = await sql`SELECT count(*), pg_size_pretty(pg_total_relation_size('ministered_songs')) as size FROM ministered_songs`;
  console.log(res);
  const sample = await sql`SELECT id, audio_file, image_url, audio_urls FROM ministered_songs LIMIT 3`;
  console.log('Sample:', sample);
  await sql.end();
}
run().catch(console.error);
