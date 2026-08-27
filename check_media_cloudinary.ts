import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const [mAssets, mVideos, zAssets] = await Promise.all([
    sql`SELECT count(*) as total, count(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') as cloudinary_count FROM media_assets;`,
    sql`SELECT count(*) as total, count(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') as cloudinary_count FROM media_videos;`,
    sql`SELECT count(*) as total, count(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') as cloudinary_count FROM zone_media_assets;`,
  ]);

  console.log('media_assets:', mAssets[0]);
  console.log('media_videos:', mVideos[0]);
  console.log('zone_media_assets:', zAssets[0]);

  // Get sample rows from media_assets that have cloudinary
  const sample = await sql`
    SELECT id, raw_data->>'name' as name, raw_data->>'url' as url, raw_data->>'fileUrl' as file_url 
    FROM media_assets 
    WHERE raw_data::text LIKE '%cloudinary%' 
    LIMIT 5;
  `;
  console.log('\nSample Cloudinary rows in media_assets:', sample);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
