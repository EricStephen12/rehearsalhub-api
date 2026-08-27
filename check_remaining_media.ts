import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const remaining = await sql`
    SELECT id, raw_data->>'name' as name, raw_data->>'url' as url, raw_data->>'createdAt' as created_at
    FROM media_assets
    WHERE raw_data::text LIKE '%cloudinary%'
    LIMIT 10;
  `;

  console.log('Sample remaining Cloudinary rows in media_assets:', remaining);

  const [total, cloud] = await Promise.all([
    sql`SELECT count(*) as total FROM media_assets;`,
    sql`SELECT count(*) as count FROM media_assets WHERE raw_data::text LIKE '%cloudinary%';`,
  ]);

  console.log(`Total rows in media_assets: ${total[0].total}`);
  console.log(`Remaining Cloudinary rows: ${cloud[0].count}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
