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

  function addUrl(table, id, url) {
    if (!url || typeof url !== 'string') return;
    if (!url.includes('cloudinary.com')) return;
    const clean = url.trim();
    if (!uniqueUrlSet.has(clean)) {
      uniqueUrlSet.add(clean);
      allItems.push({ table, id, url: clean });
    }
  }

  // 1. media_videos
  try {
    const rows = await sql`SELECT id, video_url, thumbnail, raw_data FROM media_videos`;
    for (const r of rows) {
      addUrl('media_videos', r.id, r.video_url);
      addUrl('media_videos', r.id, r.thumbnail);
      if (r.raw_data) {
        addUrl('media_videos', r.id, r.raw_data.videoUrl);
        addUrl('media_videos', r.id, r.raw_data.url);
        addUrl('media_videos', r.id, r.raw_data.thumbnail);
      }
    }
    console.log(`✓ media_videos (${rows.length} rows)`);
  } catch (e) {
    console.log('media_videos error:', e.message);
  }

  // 2. zone_media_assets
  try {
    const rows = await sql`SELECT id, raw_data->>'url' as url, raw_data->>'thumbnail' as thumbnail FROM zone_media_assets`;
    for (const r of rows) {
      addUrl('zone_media_assets', r.id, r.url);
      addUrl('zone_media_assets', r.id, r.thumbnail);
    }
    console.log(`✓ zone_media_assets (${rows.length} rows)`);
  } catch (e) {
    console.log('zone_media_assets error:', e.message);
  }

  // 3. media_assets
  try {
    const rows = await sql`SELECT id, raw_data->>'url' as url FROM media_assets`;
    for (const r of rows) {
      addUrl('media_assets', r.id, r.url);
    }
    console.log(`✓ media_assets (${rows.length} rows)`);
  } catch (e) {
    console.log('media_assets error:', e.message);
  }

  // 4. ministered_songs
  try {
    const rows = await sql`SELECT id, audio_file, image_url, audio_urls FROM ministered_songs`;
    for (const r of rows) {
      addUrl('ministered_songs', r.id, r.audio_file);
      addUrl('ministered_songs', r.id, r.image_url);
      if (r.audio_urls && typeof r.audio_urls === 'object') {
        Object.values(r.audio_urls).forEach(u => addUrl('ministered_songs', r.id, u));
      }
    }
    console.log(`✓ ministered_songs (${rows.length} rows)`);
  } catch (e) {
    console.log('ministered_songs error:', e.message);
  }

  // 5. songs
  try {
    const rows = await sql`SELECT id, audio_file, audio_urls FROM songs`;
    for (const r of rows) {
      addUrl('songs', r.id, r.audio_file);
      if (r.audio_urls && typeof r.audio_urls === 'object') {
        Object.values(r.audio_urls).forEach(u => addUrl('songs', r.id, u));
      }
    }
    console.log(`✓ songs (${rows.length} rows)`);
  } catch (e) {
    console.log('songs error:', e.message);
  }

  // 6. programs
  try {
    const rows = await sql`SELECT id, banner_image FROM programs`;
    for (const r of rows) {
      addUrl('programs', r.id, r.banner_image);
    }
    console.log(`✓ programs (${rows.length} rows)`);
  } catch (e) {
    console.log('programs error:', e.message);
  }

  // 7. profiles
  try {
    const rows = await sql`SELECT id, avatar_url, raw_data->>'bannerUrl' as banner_url FROM profiles`;
    for (const r of rows) {
      addUrl('profiles', r.id, r.avatar_url);
      addUrl('profiles', r.id, r.banner_url);
    }
    console.log(`✓ profiles (${rows.length} rows)`);
  } catch (e) {
    console.log('profiles error:', e.message);
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
