import 'dotenv/config';
import postgres from 'postgres';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client } from './src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);
const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';
const publicUrlBase = (process.env.R2_PUBLIC_URL || 'https://pub-cb7697578fcc48d3b3aeb70a47eb2f65.r2.dev').replace(/\/+$/, '');

async function main() {
  console.log('Fetching all media_assets keys from R2...');
  let continuationToken: string | undefined = undefined;
  const r2KeySet = new Set<string>();
  const r2BasenameMap = new Map<string, string>(); // basename -> r2Url

  do {
    const command: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'media_assets/',
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const res = await r2Client.send(command);
    for (const item of res.Contents || []) {
      if (item.Key) {
        r2KeySet.add(item.Key);
        const basename = item.Key.split('/').pop()?.toLowerCase();
        if (basename) {
          r2BasenameMap.set(basename, `${publicUrlBase}/${item.Key}`);
        }
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${r2KeySet.size} media_assets in R2.`);

  // Sample check against media_assets table
  const sample = await sql`
    SELECT id, raw_data->>'name' as name, raw_data->>'url' as url
    FROM media_assets
    WHERE raw_data::text LIKE '%cloudinary%'
    LIMIT 20;
  `;

  let matched = 0;
  let unmatched = 0;

  for (const s of sample) {
    const cloudUrl = s.url || '';
    const basename = cloudUrl.split('/').pop()?.split('?')[0]?.toLowerCase();
    const r2Match = basename ? r2BasenameMap.get(basename) : undefined;
    if (r2Match) {
      matched++;
      console.log(`MATCH: "${s.name}" -> ${r2Match}`);
    } else {
      unmatched++;
      console.log(`NO MATCH: "${s.name}" (${cloudUrl})`);
    }
  }

  console.log(`Sample results: Matched: ${matched}, Unmatched: ${unmatched}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
