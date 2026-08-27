import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { uploadToR2WithExactKey } from './src/services/r2Service';

const sql = postgres(process.env.DATABASE_URL!);

function getR2KeyFromCloudinaryUrl(url: string, tableHint: string): string {
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
    return `${tableHint}/${relPath}`.replace(/\/+/g, '/');
  } catch {
    const filename = path.basename(url.split('?')[0]);
    return `${tableHint}/${filename}`;
  }
}

async function downloadFromCloudinary(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RehearsalHub-Repoint/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    return { buffer, contentType };
  } catch (err) {
    return null;
  }
}

async function getUrlContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'RehearsalHub-Check/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      const getRes = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(6000),
      });
      const cr = getRes.headers.get('content-range');
      if (cr) {
        const total = cr.split('/')[1];
        if (total && !isNaN(Number(total))) return Number(total);
      }
      const cl = getRes.headers.get('content-length');
      return cl ? Number(cl) : null;
    }
    const cl = res.headers.get('content-length');
    return cl ? Number(cl) : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('======================================================');
  console.log('1. INSPECTING MANIFEST FILES IN scripts/');
  console.log('======================================================');

  const mappingPath = path.join(__dirname, 'scripts/migration_url_mapping.json');
  let urlMapping: Record<string, string> = {};
  if (fs.existsSync(mappingPath)) {
    try {
      urlMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    } catch {}
  }

  console.log('Manifest `migration_url_mapping.json` entries count:', Object.keys(urlMapping).length);
  const sampleEntryKey = Object.keys(urlMapping)[0] || 'none';
  console.log({
    manifestFormat: 'Direct old-Cloudinary-URL -> new-R2-URL key-value JSON dictionary',
    sampleOldCloudinaryUrl: sampleEntryKey,
    sampleNewR2Url: urlMapping[sampleEntryKey] || 'none',
  });

  console.log('\n======================================================');
  console.log('2. REPOINTING SONGS TO R2 (MANIFEST OR FRESH UPLOAD)');
  console.log('======================================================');

  // 1. Fetch songs with Cloudinary URLs across all song tables
  const [songRows, minRows, zoneRows, subRows] = await Promise.all([
    sql`SELECT 'songs' as tbl, id, title, audio_file, audio_urls, raw_data FROM songs WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%' LIMIT 20;`,
    sql`SELECT 'ministered_songs' as tbl, id, title, audio_file, audio_urls, raw_data FROM ministered_songs WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%' LIMIT 20;`,
    sql`SELECT 'zone_songs' as tbl, id, title, audio_file, audio_urls, raw_data FROM zone_songs WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%' LIMIT 20;`,
    sql`SELECT 'subgroup_songs' as tbl, id, title, audio_file, audio_urls, raw_data FROM subgroup_songs WHERE audio_file LIKE '%cloudinary%' OR raw_data::text LIKE '%cloudinary%' LIMIT 20;`,
  ]);

  const allCandidateRows = [...songRows, ...minRows, ...zoneRows, ...subRows];
  console.log(`Found candidate Cloudinary rows across tables: ${allCandidateRows.length} (songs: ${songRows.length}, ministered: ${minRows.length}, zone_songs: ${zoneRows.length}, subgroup_songs: ${subRows.length})`);

  let repointedViaManifest = 0;
  let repointedViaFreshUpload = 0;
  let skipped404 = 0;

  const repointedSample: {
    songId: string;
    table: string;
    title: string;
    oldUrl: string;
    newUrl: string;
    source: 'manifest' | 'fresh_upload';
  }[] = [];

  let idx = 0;
  for (const song of allCandidateRows) {
    idx++;
    const raw = (song.rawData || song.raw_data || {}) as Record<string, any>;
    let oldAudioFile = song.audio_file || raw.audioFile || raw.audioUrl || '';
    const title = song.title || raw.title || 'Untitled';

    if (oldAudioFile && oldAudioFile.includes('cloudinary.com')) {
      let r2Url = urlMapping[oldAudioFile];
      let source: 'manifest' | 'fresh_upload' = 'manifest';

      if (r2Url) {
        console.log(`[${idx}/${allCandidateRows.length}] Manifest match: "${title}" (${song.tbl}) -> ${r2Url}`);
        repointedViaManifest++;
      } else {
        console.log(`[${idx}/${allCandidateRows.length}] Downloading fresh from Cloudinary: "${title}" (${song.tbl})...`);
        const downloaded = await downloadFromCloudinary(oldAudioFile);
        if (downloaded) {
          const key = getR2KeyFromCloudinaryUrl(oldAudioFile, song.tbl);
          const uploadResult = await uploadToR2WithExactKey(downloaded.buffer, key, downloaded.contentType);
          r2Url = uploadResult.url;
          urlMapping[oldAudioFile] = r2Url;
          source = 'fresh_upload';
          console.log(`  -> Uploaded fresh to R2: ${r2Url} (${downloaded.buffer.length} bytes)`);
          repointedViaFreshUpload++;
        } else {
          console.log(`  -> Cloudinary returned 404 / error for "${title}"`);
          skipped404++;
          continue;
        }
      }

      if (r2Url) {
        raw.audioFile = r2Url;
        raw.audioUrl = r2Url;
        if (raw.audio_urls && typeof raw.audio_urls === 'object') {
          for (const k of Object.keys(raw.audio_urls)) {
            if (raw.audio_urls[k] === oldAudioFile) {
              raw.audio_urls[k] = r2Url;
            }
          }
        }

        if (song.tbl === 'songs') {
          await sql`UPDATE songs SET audio_file = ${r2Url}, raw_data = ${raw} WHERE id = ${song.id};`;
        } else if (song.tbl === 'ministered_songs') {
          await sql`UPDATE ministered_songs SET audio_file = ${r2Url}, raw_data = ${raw} WHERE id = ${song.id};`;
        } else if (song.tbl === 'zone_songs') {
          await sql`UPDATE zone_songs SET audio_file = ${r2Url}, raw_data = ${raw} WHERE id = ${song.id};`;
        } else if (song.tbl === 'subgroup_songs') {
          await sql`UPDATE subgroup_songs SET audio_file = ${r2Url}, raw_data = ${raw} WHERE id = ${song.id};`;
        }

        if (repointedSample.length < 15) {
          repointedSample.push({
            songId: song.id,
            table: song.tbl,
            title: song.title || raw.title || 'Untitled',
            oldUrl: oldAudioFile,
            newUrl: r2Url,
            source,
          });
        }
      }
    }
  }

  // Save updated mapping back to disk
  fs.writeFileSync(mappingPath, JSON.stringify(urlMapping, null, 2), 'utf-8');

  console.log(`\n--- REPOINTING STATS ---`);
  console.log(`Repointed via Manifest: ${repointedViaManifest}`);
  console.log(`Repointed via Fresh Upload: ${repointedViaFreshUpload}`);
  console.log(`Cloudinary 404 / Missing: ${skipped404}`);

  console.log('\n======================================================');
  console.log('3. 15-SONG SAMPLE SIZE VERIFICATION CHECK');
  console.log('======================================================');

  const verificationResults: any[] = [];
  for (const item of repointedSample) {
    const [oldSize, newSize] = await Promise.all([
      getUrlContentLength(item.oldUrl),
      getUrlContentLength(item.newUrl),
    ]);

    const matches = oldSize !== null && newSize !== null && oldSize === newSize;

    verificationResults.push({
      songId: item.songId,
      title: item.title,
      source: item.source,
      oldCloudinaryUrl: item.oldUrl,
      newR2Url: item.newUrl,
      oldCloudinaryBytes: oldSize,
      newR2Bytes: newSize,
      sizesMatchExact: matches,
    });
  }

  console.log(JSON.stringify(verificationResults, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
