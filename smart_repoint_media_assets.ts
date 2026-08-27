import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { r2Client } from './src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);
const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';
const publicUrlBase = (process.env.R2_PUBLIC_URL || 'https://pub-cb7697578fcc48d3b3aeb70a47eb2f65.r2.dev').replace(/\/+$/, '');

async function main() {
  console.log('========================================================');
  console.log('BUILDING IN-MEMORY INDEX OF ALL 7,430 R2 OBJECTS');
  console.log('========================================================');

  let continuationToken: string | undefined = undefined;
  const filenameToR2Url = new Map<string, string>();
  let totalIndexed = 0;

  do {
    const command: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const res = await r2Client.send(command);
    for (const item of res.Contents || []) {
      if (item.Key) {
        const fullUrl = `${publicUrlBase}/${item.Key}`;
        const filename = item.Key.split('/').pop()?.toLowerCase();
        if (filename && !filenameToR2Url.has(filename)) {
          filenameToR2Url.set(filename, fullUrl);
        }
        totalIndexed++;
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log(`Indexed ${totalIndexed} R2 objects (${filenameToR2Url.size} unique filenames).`);

  console.log('\n========================================================');
  console.log('CHECKING REPOINTING CAPABILITY FOR media_assets');
  console.log('========================================================');

  const mediaAssets = await sql`
    SELECT id, raw_data
    FROM media_assets
    WHERE raw_data::text LIKE '%cloudinary%';
  `;

  console.log(`Found ${mediaAssets.length} media_assets with Cloudinary URLs.`);

  let alreadyInR2 = 0;
  let missingFromR2 = 0;

  const updates: { id: string; oldUrl: string; newUrl: string; raw: any }[] = [];

  for (const row of mediaAssets) {
    const raw = (row.raw_data || {}) as Record<string, any>;
    const cloudUrl = raw.url || raw.fileUrl || raw.videoUrl || '';
    const filename = cloudUrl.split('/').pop()?.split('?')[0]?.toLowerCase();

    if (filename && filenameToR2Url.has(filename)) {
      alreadyInR2++;
      const newUrl = filenameToR2Url.get(filename)!;
      raw.url = newUrl;
      if (raw.fileUrl) raw.fileUrl = newUrl;
      if (raw.videoUrl) raw.videoUrl = newUrl;
      updates.push({ id: row.id, oldUrl: cloudUrl, newUrl, raw });
    } else {
      missingFromR2++;
    }
  }

  console.log(`\nResults for media_assets:`);
  console.log(`  -> ALREADY IN R2 (INSTANT REPOINT, 0 DOWNLOADS): ${alreadyInR2}`);
  console.log(`  -> NOT IN R2 (Needs fresh fetch/skip): ${missingFromR2}`);

  if (updates.length > 0) {
    console.log(`\nExecuting instant batch repoint for ${updates.length} rows in PostgreSQL...`);
    let count = 0;
    for (const u of updates) {
      await sql`UPDATE media_assets SET raw_data = ${u.raw} WHERE id = ${u.id};`;
      count++;
      if (count % 500 === 0 || count === updates.length) {
        console.log(`  Updated ${count}/${updates.length} rows...`);
      }
    }
    console.log('Done updating media_assets table!');
  }

  // Also do media_videos
  const mediaVideos = await sql`
    SELECT id, raw_data
    FROM media_videos
    WHERE raw_data::text LIKE '%cloudinary%';
  `;
  console.log(`\nFound ${mediaVideos.length} media_videos with Cloudinary URLs.`);
  let vidUpdated = 0;
  for (const row of mediaVideos) {
    const raw = (row.raw_data || {}) as Record<string, any>;
    const cloudUrl = raw.url || raw.videoUrl || '';
    const filename = cloudUrl.split('/').pop()?.split('?')[0]?.toLowerCase();
    if (filename && filenameToR2Url.has(filename)) {
      const newUrl = filenameToR2Url.get(filename)!;
      raw.url = newUrl;
      raw.videoUrl = newUrl;
      await sql`UPDATE media_videos SET raw_data = ${raw} WHERE id = ${row.id};`;
      vidUpdated++;
    }
  }
  console.log(`Repointed ${vidUpdated} media_videos to R2 instantly with 0 downloads.`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
