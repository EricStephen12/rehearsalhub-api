require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,
  max: 2,
});

function extractUrls(val) {
  if (!val) return [];
  if (typeof val === 'string') {
    if (val.includes('cloudinary.com')) {
      const matches = val.match(/https?:\/\/[^\s"'<>]*(?:cloudinary\.com)[^\s"'<>]*/g);
      return matches || [val];
    }
    return [];
  }
  if (Array.isArray(val)) {
    return val.flatMap(extractUrls);
  }
  if (typeof val === 'object') {
    return Object.values(val).flatMap(extractUrls);
  }
  return [];
}

async function run() {
  console.log('Scanning all media and song tables in PostgreSQL...\n');
  const allItems = [];
  const uniqueUrlSet = new Set();

  const tablesToScan = [
    'media_videos',
    'media_assets',
    'zone_media_assets',
    'ministered_songs',
    'songs',
    'praise_night_songs',
    'profiles',
    'programs'
  ];

  for (const table of tablesToScan) {
    try {
      let offset = 0;
      let totalFoundInTable = 0;
      while (true) {
        const rows = await sql.unsafe(`SELECT id, raw_data FROM "${table}" LIMIT 500 OFFSET ${offset}`);
        if (!rows || rows.length === 0) break;
        for (const r of rows) {
          const urls = extractUrls(r.raw_data);
          urls.forEach(u => {
            if (!uniqueUrlSet.has(u)) {
              uniqueUrlSet.add(u);
              allItems.push({ table, id: r.id, url: u });
              totalFoundInTable++;
            }
          });
        }
        offset += rows.length;
        if (rows.length < 500) break;
      }
      console.log(`✓ ${table}: ${offset} rows scanned (${totalFoundInTable} new Cloudinary URLs)`);
    } catch (e) {
      console.log(`- ${table}: ${e.message}`);
    }
  }

  const outPath = path.join(__dirname, 'cloudinary_assets.json');
  fs.writeFileSync(outPath, JSON.stringify(allItems, null, 2), 'utf-8');

  console.log(`\n====================================================`);
  console.log(`📊 TOTAL UNIQUE CLOUDINARY ASSETS FOUND: ${allItems.length}`);
  console.log(`💾 Saved asset list to: ${outPath}`);
  console.log(`====================================================`);

  await sql.end();
}

run().catch(console.error);
