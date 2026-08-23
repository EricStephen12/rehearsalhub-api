import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import postgres from 'postgres';
import fs from 'fs';
import { uploadToR2WithExactKey } from '../src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);

interface UrlMatch {
  table: string;
  id: string;
  field: string;
  url: string;
}

const args = process.argv.slice(2);
const isLive = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

function extractCloudinaryUrls(val: any, table: string, id: string, prefix = ''): UrlMatch[] {
  const results: UrlMatch[] = [];
  if (!val) return results;

  if (typeof val === 'string') {
    if (val.includes('cloudinary.com')) {
      const regex = /https?:\/\/[^\s"'<>]*(?:cloudinary\.com)[^\s"'<>]*/g;
      const matches = val.match(regex);
      if (matches) {
        matches.forEach(u => {
          results.push({ table, id, field: prefix || 'field', url: u });
        });
      } else {
        results.push({ table, id, field: prefix || 'field', url: val });
      }
    }
  } else if (Array.isArray(val)) {
    val.forEach((item, idx) => {
      results.push(...extractCloudinaryUrls(item, table, id, `${prefix}[${idx}]`));
    });
  } else if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      results.push(...extractCloudinaryUrls(v, table, id, prefix ? `${prefix}.${k}` : k));
    }
  }
  return results;
}

function getR2KeyFromCloudinaryUrl(url: string, tableHint: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const u = new URL(cleanUrl);
    const parts = u.pathname.split('/');
    const uploadIdx = parts.findIndex(p => p === 'upload');
    let relPath = '';
    if (uploadIdx !== -1 && uploadIdx < parts.length - 1) {
      const remaining = parts.slice(uploadIdx + 1).filter(p => !p.startsWith('v') && !p.startsWith('fl_') && !p.includes('c_'));
      relPath = remaining.join('/');
    } else {
      relPath = parts.slice(2).join('/');
    }

    if (!relPath) relPath = path.basename(cleanUrl);
    return `${tableHint}/${relPath}`.replace(/\/+/g, '/');
  } catch {
    const filename = path.basename(url.split('?')[0]);
    return `${tableHint}/${filename}`;
  }
}

async function downloadWithRetry(url: string, retries = 3): Promise<{ buffer: Buffer; contentType: string } | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'RehearsalHub-Migration/1.0' } });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      return { buffer, contentType };
    } catch (err) {
      if (i === retries - 1) {
        console.warn(`[Download Failed] ${url}:`, err);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

async function main() {
  console.log('====================================================');
  console.log(`📦 CLOUDINARY -> CLOUDFLARE R2 MIGRATION`);
  console.log(`Mode: ${isLive ? '🚀 LIVE MIGRATION (COPYING TO R2 & UPDATING DB)' : '🔍 DRY RUN / SCAN ONLY'}`);
  console.log('====================================================\n');

  const tables = [
    'ministered_songs',
    'songs',
    'zone_songs',
    'media_assets',
    'media_videos',
    'zone_media_assets',
    'profiles',
    'messages',
    'submitted_songs',
    'settings',
  ];

  const allMatches: UrlMatch[] = [];
  const uniqueUrlSet = new Set<string>();

  for (const table of tables) {
    try {
      const rows = await sql.unsafe(`SELECT id, raw_data FROM "${table}" WHERE raw_data::text LIKE '%cloudinary%'`);
      console.log(`Table "${table}": found ${rows.length} rows with Cloudinary assets`);

      for (const row of rows) {
        const id = String(row.id || '');
        if (row.raw_data) {
          const matches = extractCloudinaryUrls(row.raw_data, table, id, 'raw_data');
          for (const m of matches) {
            allMatches.push(m);
            uniqueUrlSet.add(m.url);
          }
        }
      }
    } catch (err: any) {
      console.warn(`Skipping table ${table}: ${err.message}`);
    }
  }

  console.log(`\n📊 Scan Summary:`);
  console.log(`- Total Cloudinary references in DB: ${allMatches.length}`);
  console.log(`- Total Unique Files to Migrate: ${uniqueUrlSet.size}`);

  const tableCounts: Record<string, number> = {};
  for (const m of allMatches) {
    tableCounts[m.table] = (tableCounts[m.table] || 0) + 1;
  }
  for (const [tbl, count] of Object.entries(tableCounts)) {
    console.log(`   • ${tbl}: ${count} references`);
  }

  if (!isLive) {
    console.log(`\n💡 To start the live migration and copy all files to Cloudflare R2, run:`);
    console.log(`   npx tsx scripts/migrate-cloudinary-to-r2.ts --live`);
    console.log(`\n(Or test first 10 items: npx tsx scripts/migrate-cloudinary-to-r2.ts --live --limit=10)`);
    await sql.end();
    process.exit(0);
  }

  // 2. Live Migration
  console.log(`\n🚀 Starting Migration of unique files...`);
  const uniqueUrls = Array.from(uniqueUrlSet).slice(0, limit);
  const urlMapping: Record<string, string> = {};
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < uniqueUrls.length; i++) {
    const oldUrl = uniqueUrls[i];
    const match = allMatches.find(m => m.url === oldUrl) || { table: 'general' };
    const key = getR2KeyFromCloudinaryUrl(oldUrl, match.table);

    console.log(`[${i + 1}/${uniqueUrls.length}] Downloading: ${oldUrl}`);
    const downloaded = await downloadWithRetry(oldUrl);

    if (!downloaded) {
      console.warn(`❌ Failed to download: ${oldUrl}`);
      failCount++;
      continue;
    }

    try {
      const uploadRes = await uploadToR2WithExactKey(downloaded.buffer, key, downloaded.contentType);
      const newUrl = uploadRes.url;
      urlMapping[oldUrl] = newUrl;
      successCount++;
      console.log(`   ✅ Copied to R2: ${newUrl} (${Math.round(downloaded.buffer.length / 1024)} KB)`);
    } catch (err: any) {
      console.error(`   ❌ Failed to upload to R2 (${key}):`, err.message);
      failCount++;
    }
  }

  // 3. Save mapping log to disk
  const logPath = path.join(__dirname, 'migration_url_mapping.json');
  fs.writeFileSync(logPath, JSON.stringify(urlMapping, null, 2), 'utf-8');
  console.log(`\n💾 Saved URL mapping to: ${logPath}`);

  // 4. Update database rows
  console.log(`\n🔄 Updating database references...`);

  for (const [oldUrl, newUrl] of Object.entries(urlMapping)) {
    for (const table of tables) {
      try {
        await sql.unsafe(`
          UPDATE "${table}"
          SET raw_data = REPLACE(raw_data::text, '${oldUrl.replace(/'/g, "''")}', '${newUrl.replace(/'/g, "''")}')::jsonb
          WHERE raw_data::text LIKE '%${oldUrl.replace(/'/g, "''")}%'
        `);
      } catch {}
    }
  }

  console.log(`\n🎉 Migration Complete!`);
  console.log(`- Files Copied to R2: ${successCount}`);
  console.log(`- Files Failed: ${failCount}`);
  console.log(`- Database records updated.`);

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Fatal Error during migration:', err);
  await sql.end();
  process.exit(1);
});
