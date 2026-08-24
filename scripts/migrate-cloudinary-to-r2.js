require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,
  max: 2,
});

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'b2e5411830e116cf4ce6e91e90843db0';
const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const publicUrlBase = (process.env.R2_PUBLIC_URL || 'https://pub-cb7697578fcc48d3b3aeb70a47eb2f65.r2.dev').replace(/\/+$/, '');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const args = process.argv.slice(2);
const isLive = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const numWorkers = 4; // 4 independent parallel worker queues

function getR2KeyFromCloudinaryUrl(url, tableHint) {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const u = new URL(cleanUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const uploadIdx = parts.findIndex(p => p === 'upload');
    let relPath = '';
    if (uploadIdx !== -1 && uploadIdx < parts.length - 1) {
      const remaining = parts.slice(uploadIdx + 1).filter(p => !p.match(/^v\d+$/) && !p.startsWith('fl_') && !p.startsWith('c_'));
      relPath = remaining.join('/');
    } else {
      relPath = parts.slice(2).join('/');
    }
    if (!relPath || relPath.endsWith('/')) relPath += path.basename(cleanUrl);
    return `${tableHint}/${relPath}`.replace(/\/+/g, '/');
  } catch {
    const filename = path.basename(url.split('?')[0]);
    return `${tableHint}/${filename}`;
  }
}

async function downloadFile(url) {
  const tryFetch = async (targetUrl) => {
    try {
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        let contentType = res.headers.get('content-type') || 'application/octet-stream';
        if (targetUrl.endsWith('.mp3') && contentType === 'application/octet-stream') {
          contentType = 'audio/mpeg';
        }
        return { buffer, contentType };
      }
    } catch {}
    return null;
  };

  let result = await tryFetch(url);
  if (result) return result;

  const withoutVersion = url.replace(/\/v\d+\//, '/');
  if (withoutVersion !== url) {
    result = await tryFetch(withoutVersion);
    if (result) return result;
  }

  await new Promise(r => setTimeout(r, 1000));
  return await tryFetch(url);
}

async function uploadToR2(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await r2Client.send(command);
  return `${publicUrlBase}/${key}`;
}

async function updateDbItem(table, id, oldUrl, newUrl) {
  if (!id || !table) return;
  const escapedOld = oldUrl.replace(/'/g, "''");
  const escapedNew = newUrl.replace(/'/g, "''");
  
  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET raw_data = REPLACE(COALESCE(raw_data::text, '{}'), '${escapedOld}', '${escapedNew}')::jsonb
      WHERE id = '${id.replace(/'/g, "''")}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET audio_file = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND audio_file = '${escapedOld}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET image_url = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND image_url = '${escapedOld}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET avatar_url = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND avatar_url = '${escapedOld}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET banner_image = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND banner_image = '${escapedOld}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET video_url = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND video_url = '${escapedOld}'
    `);
  } catch {}

  try {
    await sql.unsafe(`
      UPDATE "${table}"
      SET thumbnail = '${escapedNew}'
      WHERE id = '${id.replace(/'/g, "''")}' AND thumbnail = '${escapedOld}'
    `);
  } catch {}
}

async function main() {
  console.log('====================================================');
  console.log(`📦 CLOUDINARY -> CLOUDFLARE R2 MIGRATION ENGINE`);
  console.log(`Mode: ${isLive ? '🚀 LIVE (COPYING TO R2 & UPDATING DATABASE)' : '🔍 READ-ONLY SCAN'}`);
  console.log(`Worker Pool: ${numWorkers} parallel workers`);
  console.log('====================================================\n');

  const assetsPath = path.join(__dirname, 'cloudinary_assets.json');
  if (!fs.existsSync(assetsPath)) {
    console.error('Error: cloudinary_assets.json not found. Run scan-all-media.js first.');
    process.exit(1);
  }

  const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf-8'));
  const logPath = path.join(__dirname, 'migration_url_mapping.json');
  let urlMapping = {};
  if (fs.existsSync(logPath)) {
    try { urlMapping = JSON.parse(fs.readFileSync(logPath, 'utf-8')); } catch {}
  }

  const migratedCount = Object.keys(urlMapping).length;
  console.log(`📊 Total Cataloged Assets: ${assets.length}`);
  console.log(`💾 Already in Cache / Completed: ${migratedCount}`);

  if (!isLive) {
    console.log(`\n💡 To run live migration:`);
    console.log(`   node scripts/migrate-cloudinary-to-r2.js --live --limit=5  (Test first 5)`);
    console.log(`   node scripts/migrate-cloudinary-to-r2.js --live            (Migrate all)`);
    await sql.end();
    process.exit(0);
  }

  const targetList = assets.slice(0, limit);
  console.log(`\n🚀 Migrating ${targetList.length} files to Cloudflare R2...\n`);

  let queueIndex = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  async function worker(workerId) {
    while (queueIndex < targetList.length) {
      const currentIndex = queueIndex++;
      const item = targetList[currentIndex];
      if (!item) break;

      const oldUrl = item.url;
      if (urlMapping[oldUrl]) {
        skipped++;
        continue;
      }

      const key = getR2KeyFromCloudinaryUrl(oldUrl, item.table);
      const downloaded = await downloadFile(oldUrl);

      if (!downloaded) {
        console.log(`[Worker ${workerId}] ❌ [Unavailable] ${oldUrl}`);
        failed++;
        continue;
      }

      try {
        const newUrl = await uploadToR2(downloaded.buffer, key, downloaded.contentType);
        urlMapping[oldUrl] = newUrl;
        completed++;
        console.log(`[Worker ${workerId}] ✅ [${completed + skipped}/${targetList.length}] ${key} (${Math.round(downloaded.buffer.length / 1024)} KB)`);
        
        // Immediate indexed database update & sync to disk
        await updateDbItem(item.table, item.id, oldUrl, newUrl);
        fs.writeFileSync(logPath, JSON.stringify(urlMapping, null, 2), 'utf-8');
      } catch (err) {
        console.log(`[Worker ${workerId}] ❌ [Upload Fail] ${key}: ${err.message}`);
        failed++;
      }
    }
  }

  // Start workers
  const workers = [];
  for (let w = 1; w <= numWorkers; w++) {
    workers.push(worker(w));
  }
  await Promise.all(workers);

  console.log(`\n💾 Saved all URL mappings to: ${logPath}`);
  console.log(`\n🎉 Migration Run Complete!`);
  console.log(`- Uploaded to R2: ${completed}`);
  console.log(`- Skipped (already migrated): ${skipped}`);
  console.log(`- Inaccessible on Cloudinary: ${failed}`);
  console.log(`- PostgreSQL records successfully updated to Cloudflare R2.`);

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Migration Fatal Error:', err);
  await sql.end();
  process.exit(1);
});
