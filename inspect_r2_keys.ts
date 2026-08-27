import 'dotenv/config';
import postgres from 'postgres';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client } from './src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);
const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';

async function main() {
  console.log('Fetching sample keys from R2 in media_assets/...');
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: 'media_assets/',
    MaxKeys: 25,
  });

  const res = await r2Client.send(command);
  console.log('Sample R2 keys:');
  console.log((res.Contents || []).map(c => c.Key));

  // Also fetch sample cloudinary URLs from DB
  const dbSample = await sql`
    SELECT id, raw_data->>'name' as name, raw_data->>'url' as url
    FROM media_assets
    WHERE raw_data::text LIKE '%cloudinary%'
    LIMIT 10;
  `;
  console.log('\nSample DB rows:', dbSample);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
