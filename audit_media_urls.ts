import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  console.log('====================================================');
  console.log('FULL DATABASE AUDIT: CLOUDINARY VS R2 URL COUNTS');
  console.log('====================================================');

  const queries: { table: string; query: string }[] = [
    {
      table: 'media_assets',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.cloudflarestorage.com%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM media_assets;
      `,
    },
    {
      table: 'media_videos',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE video_url LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE video_url LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM media_videos;
      `,
    },
    {
      table: 'zone_media_assets',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM zone_media_assets;
      `,
    },
    {
      table: 'songs',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE audio_file LIKE '%cloudinary%' OR audio_urls::text LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE audio_file LIKE '%r2.dev%' OR audio_urls::text LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM songs;
      `,
    },
    {
      table: 'ministered_songs',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE audio_file LIKE '%cloudinary%' OR audio_urls::text LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE audio_file LIKE '%r2.dev%' OR audio_urls::text LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM ministered_songs;
      `,
    },
    {
      table: 'zone_songs',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE audio_file LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM zone_songs;
      `,
    },
    {
      table: 'subgroup_songs',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE audio_file LIKE '%r2.dev%' OR raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM subgroup_songs;
      `,
    },
    {
      table: 'submitted_songs',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM submitted_songs;
      `,
    },
    {
      table: 'notifications',
      query: `
        SELECT
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%cloudinary%') AS still_on_cloudinary,
          COUNT(*) FILTER (WHERE raw_data::text LIKE '%r2.dev%') AS migrated_to_r2,
          COUNT(*) AS total
        FROM notifications;
      `,
    },
  ];

  for (const q of queries) {
    try {
      const res = await rawPgClient.unsafe(q.query);
      console.log(`\nTable: [${q.table}]`);
      console.log(JSON.stringify(res[0], null, 2));
    } catch (e: any) {
      console.log(`\nTable: [${q.table}] - Error: ${e.message}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
