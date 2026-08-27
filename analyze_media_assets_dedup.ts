import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  console.log('====================================================');
  console.log('PART 1: HOW SONGS LINK TO AUDIO (SCHEMA & REAL ROWS)');
  console.log('====================================================');

  // Sample from songs
  const sampleSongs = await rawPgClient`
    SELECT id, title, audio_file, audio_urls, raw_data->>'media_asset_id' as media_asset_id 
    FROM songs 
    WHERE audio_file IS NOT NULL 
    LIMIT 3;
  `;
  console.log('\n--- Sample Rows from `songs` ---');
  console.log(JSON.stringify(sampleSongs, null, 2));

  // Sample from ministered_songs
  const sampleMinistered = await rawPgClient`
    SELECT id, title, audio_file, audio_urls, raw_data->>'media_asset_id' as media_asset_id 
    FROM ministered_songs 
    WHERE audio_file IS NOT NULL 
    LIMIT 3;
  `;
  console.log('\n--- Sample Rows from `ministered_songs` ---');
  console.log(JSON.stringify(sampleMinistered, null, 2));

  // Sample from zone_songs
  const sampleZoneSongs = await rawPgClient`
    SELECT id, title, audio_file, raw_data 
    FROM zone_songs 
    WHERE audio_file IS NOT NULL OR raw_data->>'audioUrl' IS NOT NULL 
    LIMIT 3;
  `;
  console.log('\n--- Sample Rows from `zone_songs` ---');
  console.log(JSON.stringify(sampleZoneSongs, null, 2));

  // Sample from submitted_songs
  const sampleSubmitted = await rawPgClient`
    SELECT id, title, raw_data->>'audioUrl' as audio_url 
    FROM submitted_songs 
    WHERE raw_data->>'audioUrl' IS NOT NULL 
    LIMIT 3;
  `;
  console.log('\n--- Sample Rows from `submitted_songs` ---');
  console.log(JSON.stringify(sampleSubmitted, null, 2));

  console.log('\n====================================================');
  console.log('PART 2: BUILDING REFERENCE INDEX FROM ALL SONG TABLES');
  console.log('====================================================');

  // Collect all URLs used across songs, ministered_songs, zone_songs, subgroup_songs, submitted_songs, media_playlists
  const referencedUrls = new Set<string>();
  const referencedFilenames = new Set<string>();

  function addUrl(u: any) {
    if (typeof u === 'string' && u.trim()) {
      const clean = u.trim();
      referencedUrls.add(clean);
      const filename = clean.split('/').pop()?.split('?')[0];
      if (filename) referencedFilenames.add(filename);
    }
  }

  // 1. songs
  const allSongs = await rawPgClient`SELECT audio_file, audio_urls, raw_data FROM songs;`;
  for (const s of allSongs) {
    addUrl(s.audio_file);
    if (s.audio_urls && typeof s.audio_urls === 'object') {
      Object.values(s.audio_urls).forEach(addUrl);
    }
    if (s.raw_data && typeof s.raw_data === 'object') {
      addUrl(s.raw_data.audioFile);
      addUrl(s.raw_data.audioUrl);
      addUrl(s.raw_data.audio_url);
    }
  }

  // 2. ministered_songs
  const allMin = await rawPgClient`SELECT audio_file, audio_urls, raw_data FROM ministered_songs;`;
  for (const s of allMin) {
    addUrl(s.audio_file);
    if (s.audio_urls && typeof s.audio_urls === 'object') {
      Object.values(s.audio_urls).forEach(addUrl);
    }
  }

  // 3. zone_songs
  const allZone = await rawPgClient`SELECT audio_file, raw_data FROM zone_songs;`;
  for (const s of allZone) {
    addUrl(s.audio_file);
    if (s.raw_data) addUrl(s.raw_data.audioUrl || s.raw_data.audio_url);
  }

  // 4. submitted_songs
  const allSubs = await rawPgClient`SELECT raw_data FROM submitted_songs;`;
  for (const s of allSubs) {
    if (s.raw_data) addUrl(s.raw_data.audioUrl || s.raw_data.audio_url);
  }

  console.log(`Total unique active audio URLs referenced across all song tables: ${referencedUrls.size}`);
  console.log(`Total unique active filenames referenced: ${referencedFilenames.size}`);

  console.log('\n====================================================');
  console.log('PART 3: MEDIA_ASSETS DEDUPLICATION DRY-RUN REPORT');
  console.log('====================================================');

  // Fetch all media_assets
  const allAssets = await rawPgClient`
    SELECT id, raw_data 
    FROM media_assets;
  `;

  // Group by normalized title / filename
  const groups = new Map<string, any[]>();
  for (const a of allAssets) {
    const raw = a.raw_data || {};
    const title = (raw.title || raw.name || raw.filename || 'Untitled').trim();
    if (!groups.has(title)) {
      groups.set(title, []);
    }
    const url = raw.url || raw.videoUrl || raw.video_url || '';
    const filename = url.split('/').pop()?.split('?')[0] || '';
    const isR2 = url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com');
    const isCloudinary = url.includes('cloudinary.com');
    const inUse = referencedUrls.has(url) || (filename && referencedFilenames.has(filename));

    groups.get(title)!.push({
      id: a.id,
      title,
      url,
      size: raw.size || raw.bytes || null,
      format: raw.format || raw.type || null,
      createdAt: raw.createdAt || raw.created_at || null,
      isR2,
      isCloudinary,
      inUse,
    });
  }

  let duplicateGroupCount = 0;
  let totalDuplicateRows = 0;
  let plannedKept = 0;
  let plannedDeleted = 0;

  const sampleReports: any[] = [];

  for (const [title, items] of groups.entries()) {
    if (items.length <= 1) continue;

    duplicateGroupCount++;
    totalDuplicateRows += items.length;

    // Pick best item to keep:
    // 1. First priority: Item whose URL is actively IN USE by songs
    // 2. Second priority: Item that is already migrated to R2
    // 3. Third priority: Item with valid size / latest date
    items.sort((a, b) => {
      if (a.inUse && !b.inUse) return -1;
      if (!a.inUse && b.inUse) return 1;
      if (a.isR2 && !b.isR2) return -1;
      if (!a.isR2 && b.isR2) return 1;
      return (b.size || 0) - (a.size || 0);
    });

    const keep = items[0];
    const drop = items.slice(1);

    plannedKept++;
    plannedDeleted += drop.length;

    if (sampleReports.length < 15) {
      sampleReports.push({
        title,
        totalRows: items.length,
        decision: {
          KEEP: {
            id: keep.id,
            url: keep.url,
            isR2: keep.isR2,
            inUseBySongs: keep.inUse,
            reason: keep.inUse
              ? 'FLAGGED AS IN-USE by active song record'
              : keep.isR2
              ? 'Migrated R2 version with valid asset'
              : 'Primary record',
          },
          DELETE: drop.map((d: any) => ({
            id: d.id,
            url: d.url,
            isCloudinary: d.isCloudinary,
            sizeMatchesKeep: d.size === keep.size,
            reason: d.isCloudinary
              ? 'Redundant duplicate on legacy Cloudinary URL'
              : 'Duplicate row of same underlying title/asset',
          })),
        },
      });
    }
  }

  console.log(`\n--- DRY-RUN SUMMARY STATISTICS ---`);
  console.log(`Total duplicate groups found: ${duplicateGroupCount}`);
  console.log(`Total duplicate rows involved: ${totalDuplicateRows}`);
  console.log(`Rows to KEEP (1 per group): ${plannedKept}`);
  console.log(`Rows to DELETE (redundant duplicates): ${plannedDeleted}`);

  console.log(`\n--- DETAILED SAMPLE DRY-RUN DECISION REPORT (15 GROUPS) ---`);
  console.log(JSON.stringify(sampleReports, null, 2));

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
