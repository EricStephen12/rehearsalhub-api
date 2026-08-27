import 'dotenv/config';
import postgres from 'postgres';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const sql = postgres(process.env.DATABASE_URL!);

import { r2Client } from './src/services/r2Service';

const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';

async function main() {
  console.log('========================================================');
  console.log(`INSPECTING R2 BUCKET: "${bucketName}"`);
  console.log('========================================================');

  let continuationToken: string | undefined = undefined;
  let totalObjects = 0;
  let totalBytes = 0;
  const folderCounts: Record<string, { count: number; bytes: number }> = {};
  const allKeys: string[] = [];

  console.log('Scanning R2 bucket objects...');

  do {
    const command: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const res = await r2Client.send(command);
    const contents = res.Contents || [];
    totalObjects += contents.length;

    for (const obj of contents) {
      if (!obj.Key) continue;
      allKeys.push(obj.Key);
      const size = obj.Size || 0;
      totalBytes += size;

      const topFolder = obj.Key.includes('/') ? obj.Key.split('/')[0] : '(root)';
      if (!folderCounts[topFolder]) {
        folderCounts[topFolder] = { count: 0, bytes: 0 };
      }
      folderCounts[topFolder].count++;
      folderCounts[topFolder].bytes += size;
    }

    continuationToken = res.NextContinuationToken;
    process.stdout.write(`Scanned ${totalObjects} objects...\r`);
  } while (continuationToken);

  console.log(`\n\n--- R2 BUCKET SUMMARY ---`);
  console.log(`Total Objects in R2: ${totalObjects}`);
  console.log(`Total Storage Size: ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log('\n--- BREAKDOWN BY FOLDER PREFIX ---');
  console.table(
    Object.entries(folderCounts)
      .map(([folder, stat]) => ({
        Folder: folder,
        'Objects Count': stat.count,
        'Size (MB)': (stat.bytes / (1024 * 1024)).toFixed(2),
      }))
      .sort((a, b) => b['Objects Count'] - a['Objects Count'])
  );

  console.log('\n========================================================');
  console.log('CHECKING DATABASE REFERENCES AGAINST R2');
  console.log('========================================================');

  // Query all URLs stored in database across tables
  const [songUrls, zoneUrls, minUrls, subUrls, mediaUrls, chatUrls] = await Promise.all([
    sql`SELECT raw_data FROM songs;`,
    sql`SELECT raw_data FROM zone_songs;`,
    sql`SELECT raw_data FROM ministered_songs;`,
    sql`SELECT raw_data FROM subgroup_songs;`,
    sql`SELECT raw_data FROM media_assets;`,
    sql`SELECT raw_data FROM messages;`,
  ]);

  const dbUrlSet = new Set<string>();

  const extractUrls = (row: any) => {
    if (!row) return;
    const str = JSON.stringify(row);
    const matches = str.match(/https:\/\/[^"'\s\\]+/g);
    if (matches) {
      matches.forEach((u) => {
        if (u.includes('r2.dev') || u.includes('cloudinary.com')) {
          dbUrlSet.add(u);
        }
      });
    }
  };

  [...songUrls, ...zoneUrls, ...minUrls, ...subUrls, ...mediaUrls, ...chatUrls].forEach(extractUrls);

  console.log(`Total distinct media URLs referenced in Postgres: ${dbUrlSet.size}`);

  let r2ObjectsReferencedInDb = 0;
  let r2ObjectsNotReferencedInDb = 0;

  for (const key of allKeys) {
    const isReferenced = Array.from(dbUrlSet).some((url) => url.includes(key));
    if (isReferenced) {
      r2ObjectsReferencedInDb++;
    } else {
      r2ObjectsNotReferencedInDb++;
    }
  }

  console.log(`R2 Objects referenced by DB records: ${r2ObjectsReferencedInDb}`);
  console.log(`R2 Objects unreferenced (orphaned / historical batch artifacts): ${r2ObjectsNotReferencedInDb}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
