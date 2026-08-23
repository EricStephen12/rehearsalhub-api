require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,
  max: 1,
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
  console.log('Scanning all media tables in PostgreSQL with paginated batches...\n');
  const allItems = [];
  const uniqueUrlSet = new Set();

  // 1. ministered_songs (822 rows in batches of 300)
  try {
    let offset = 0;
    while (true) {
      const rows = await sql`SELECT id, audio_file, image_url, audio_urls FROM ministered_songs LIMIT 300 OFFSET ${offset}`;
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const urls = [
          ...extractUrls(r.audio_file),
          ...extractUrls(r.image_url),
          ...extractUrls(r.audio_urls),
        ];
        urls.forEach(u => {
          if (!uniqueUrlSet.has(u)) {
            uniqueUrlSet.add(u);
            allItems.push({ table: 'ministered_songs', id: r.id, url: u });
          }
        });
      }
      offset += rows.length;
      if (rows.length < 300) break;
    }
    console.log(`✓ ministered_songs (${offset} rows scanned)`);
  } catch (e) {
    console.log('ministered_songs error:', e.message);
  }

  // 2. songs (2,478 rows in batches of 300)
  try {
    let offset = 0;
    while (true) {
      const rows = await sql`SELECT id, audio_file, audio_urls FROM songs LIMIT 300 OFFSET ${offset}`;
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const urls = [
          ...extractUrls(r.audio_file),
          ...extractUrls(r.audio_urls),
        ];
        urls.forEach(u => {
          if (!uniqueUrlSet.has(u)) {
            uniqueUrlSet.add(u);
            allItems.push({ table: 'songs', id: r.id, url: u });
          }
        });
      }
      offset += rows.length;
      if (rows.length < 300) break;
    }
    console.log(`✓ songs (${offset} rows scanned)`);
  } catch (e) {
    console.log('songs error:', e.message);
  }

  // 3. profiles
  try {
    const rows = await sql`SELECT id, avatar_url, raw_data FROM profiles`;
    for (const r of rows) {
      const urls = [...extractUrls(r.avatar_url), ...extractUrls(r.raw_data?.bannerUrl)];
      urls.forEach(u => {
        if (!uniqueUrlSet.has(u)) {
          uniqueUrlSet.add(u);
          allItems.push({ table: 'profiles', id: r.id, url: u });
        }
      });
    }
    console.log(`✓ profiles (${rows.length} rows)`);
  } catch (e) {
    console.log('profiles error:', e.message);
  }

  // 4. programs
  try {
    const rows = await sql`SELECT id, banner_image FROM programs`;
    for (const r of rows) {
      const urls = extractUrls(r.banner_image);
      urls.forEach(u => {
        if (!uniqueUrlSet.has(u)) {
          uniqueUrlSet.add(u);
          allItems.push({ table: 'programs', id: r.id, url: u });
        }
      });
    }
    console.log(`✓ programs (${rows.length} rows)`);
  } catch (e) {
    console.log('programs error:', e.message);
  }

  const outPath = path.join(__dirname, 'cloudinary_assets.json');
  fs.writeFileSync(outPath, JSON.stringify(allItems, null, 2), 'utf-8');

  console.log(`\n====================================================`);
  console.log(`📊 TOTAL UNIQUE CLOUDINARY ASSETS: ${allItems.length}`);
  console.log(`💾 Saved asset list to: ${outPath}`);
  console.log(`====================================================`);

  await sql.end();
}

run().catch(console.error);
