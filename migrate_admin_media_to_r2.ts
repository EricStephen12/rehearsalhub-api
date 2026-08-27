import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { uploadToR2WithExactKey } from './src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);
const mappingPath = path.join(__dirname, 'scripts/migration_url_mapping.json');

let urlMapping: Record<string, string> = {};
if (fs.existsSync(mappingPath)) {
  try {
    urlMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
  } catch {}
}

function getR2KeyFromCloudinaryUrl(url: string, folder: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const u = new URL(cleanUrl);
    const parts = u.pathname.split('/');
    const uploadIdx = parts.findIndex((p) => p === 'upload');
    let relPath = '';
    if (uploadIdx !== -1 && uploadIdx < parts.length - 1) {
      const remaining = parts
        .slice(uploadIdx + 1)
        .filter((p) => !p.startsWith('v') && !p.startsWith('fl_') && !p.includes('c_'));
      relPath = remaining.join('/');
    } else {
      relPath = parts.slice(2).join('/');
    }

    if (!relPath) relPath = path.basename(cleanUrl);
    return `${folder}/${relPath}`.replace(/\/+/g, '/');
  } catch {
    const filename = path.basename(url.split('?')[0]);
    return `${folder}/${filename}`;
  }
}

async function downloadFromCloudinary(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RehearsalHub-MediaMigrate/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function main() {
  console.log('========================================================');
  console.log('MIGRATING ADMIN MEDIA LIBRARY (media_assets & media_videos) TO R2');
  console.log('========================================================');

  const [mediaRows, videoRows] = await Promise.all([
    sql`SELECT id, raw_data FROM media_assets WHERE raw_data::text LIKE '%cloudinary%' LIMIT 100;`,
    sql`SELECT id, raw_data FROM media_videos WHERE raw_data::text LIKE '%cloudinary%' LIMIT 50;`,
  ]);

  console.log(`Processing batch of ${mediaRows.length} media_assets and ${videoRows.length} media_videos...`);

  let repointed = 0;
  let skipped404 = 0;

  for (const item of mediaRows) {
    const raw = (item.raw_data || {}) as Record<string, any>;
    const cloudUrl = raw.url || raw.fileUrl || raw.videoUrl || '';

    if (cloudUrl && cloudUrl.includes('cloudinary.com')) {
      let r2Url = urlMapping[cloudUrl];

      if (!r2Url) {
        const downloaded = await downloadFromCloudinary(cloudUrl);
        if (downloaded) {
          const key = getR2KeyFromCloudinaryUrl(cloudUrl, 'media_assets');
          const res = await uploadToR2WithExactKey(downloaded.buffer, key, downloaded.contentType);
          r2Url = res.url;
          urlMapping[cloudUrl] = r2Url;
        } else {
          skipped404++;
          continue;
        }
      }

      if (r2Url) {
        raw.url = r2Url;
        if (raw.fileUrl) raw.fileUrl = r2Url;
        if (raw.videoUrl) raw.videoUrl = r2Url;
        await sql`UPDATE media_assets SET raw_data = ${raw} WHERE id = ${item.id};`;
        repointed++;
        console.log(`[media_assets] Repointed: "${raw.name || raw.title}" -> ${r2Url}`);
      }
    }
  }

  for (const item of videoRows) {
    const raw = (item.raw_data || {}) as Record<string, any>;
    const cloudUrl = raw.url || raw.videoUrl || raw.fileUrl || '';

    if (cloudUrl && cloudUrl.includes('cloudinary.com')) {
      let r2Url = urlMapping[cloudUrl];

      if (!r2Url) {
        const downloaded = await downloadFromCloudinary(cloudUrl);
        if (downloaded) {
          const key = getR2KeyFromCloudinaryUrl(cloudUrl, 'media_videos');
          const res = await uploadToR2WithExactKey(downloaded.buffer, key, downloaded.contentType);
          r2Url = res.url;
          urlMapping[cloudUrl] = r2Url;
        } else {
          skipped404++;
          continue;
        }
      }

      if (r2Url) {
        raw.url = r2Url;
        raw.videoUrl = r2Url;
        await sql`UPDATE media_videos SET raw_data = ${raw} WHERE id = ${item.id};`;
        repointed++;
        console.log(`[media_videos] Repointed: "${raw.title || raw.name}" -> ${r2Url}`);
      }
    }
  }

  fs.writeFileSync(mappingPath, JSON.stringify(urlMapping, null, 2), 'utf-8');

  console.log('\n--- SUMMARY ---');
  console.log(`Successfully repointed to R2: ${repointed}`);
  console.log(`Cloudinary 404 / Inaccessible: ${skipped404}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
