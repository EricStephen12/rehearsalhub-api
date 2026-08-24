require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', prepare: false });

async function check() {
  const rows = await sql`SELECT id, raw_data FROM "ministered_songs" LIMIT 6`;
  for (const r of rows) {
    const raw = r.raw_data || {};
    console.log('ID:', r.id);
    console.log('title:', raw.title);
    console.log('audioFile:', raw.audioFile || raw.audio_file || raw.audioUrl || raw.audio_url);
    console.log('audioUrls:', raw.audioUrls || raw.audio_urls);
    console.log('customParts:', raw.customParts || raw.custom_parts);
    console.log('keys in raw_data:', Object.keys(raw).filter(k => k.toLowerCase().includes('audio') || k.toLowerCase().includes('url') || k.toLowerCase().includes('file') || k.toLowerCase().includes('part') || k.toLowerCase().includes('stem')));
    console.log('--------------------------------------------------');
  }
  await sql.end();
}

check().catch(console.error);
