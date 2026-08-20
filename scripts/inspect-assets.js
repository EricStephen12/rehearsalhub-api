require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function check() {
  const assets = await sql`SELECT id, raw_data FROM media_assets LIMIT 5`;
  console.log('Sample media_assets:', JSON.stringify(assets, null, 2));

  const zoneAssets = await sql`SELECT id, raw_data FROM zone_media_assets LIMIT 5`;
  console.log('Sample zone_media_assets:', JSON.stringify(zoneAssets, null, 2));

  const typesCount = await sql`
    SELECT raw_data->>'type' as type, count(*) 
    FROM media_assets 
    GROUP BY raw_data->>'type'
  `;
  console.log('media_assets by type:', typesCount);

  await sql.end();
}

check();
