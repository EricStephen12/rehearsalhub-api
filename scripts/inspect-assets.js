require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function check() {
  const t0 = Date.now();
  const [videoCount] = await sql`SELECT count(*) FROM media_videos`;
  const [assetCount] = await sql`SELECT count(*) FROM media_assets`;
  const [zoneAssetCount] = await sql`SELECT count(*) FROM zone_media_assets`;
  const [songsCount] = await sql`SELECT count(*) FROM songs`;
  const [ministeredCount] = await sql`SELECT count(*) FROM ministered_songs`;

  console.log('Database Counts:', {
    media_videos: videoCount.count,
    media_assets: assetCount.count,
    zone_media_assets: zoneAssetCount.count,
    songs: songsCount.count,
    ministered_songs: ministeredCount.count,
    total_media: Number(videoCount.count) + Number(assetCount.count) + Number(zoneAssetCount.count),
    queryTimeMs: Date.now() - t0,
  });

  await sql.end();
}

check();

