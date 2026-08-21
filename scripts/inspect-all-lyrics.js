require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function inspectLyrics() {
  console.log('=== INSPECTING MINISTERED_SONGS FOR LYRICS ===');
  const mSongsWithLrc = await sql`
    SELECT id, title, raw_data->>'karaokeLrcText' as lrc, raw_data->>'hasSyncedLyrics' as has_sync, raw_data->'syncedLyrics' as synced
    FROM ministered_songs
    WHERE raw_data->>'karaokeLrcText' IS NOT NULL 
       OR raw_data->'syncedLyrics' IS NOT NULL 
       OR raw_data->>'hasSyncedLyrics' = 'true'
    LIMIT 10
  `;
  console.log(`Found ${mSongsWithLrc.length} ministered_songs with lyrics/LRC:`);
  for (const s of mSongsWithLrc) {
    console.log(`- ID: ${s.id} | Title: "${s.title}"`);
    console.log(`  LRC Preview:`, s.lrc ? s.lrc.substring(0, 100) : 'null');
    console.log(`  Synced count:`, Array.isArray(s.synced) ? s.synced.length : typeof s.synced);
  }

  console.log('\n=== INSPECTING SONGS TABLE FOR LYRICS ===');
  const songsWithLrc = await sql`
    SELECT id, title, raw_data->>'karaokeLrcText' as lrc, raw_data->>'hasSyncedLyrics' as has_sync, raw_data->'syncedLyrics' as synced
    FROM songs
    WHERE raw_data->>'karaokeLrcText' IS NOT NULL 
       OR raw_data->'syncedLyrics' IS NOT NULL 
       OR raw_data->>'hasSyncedLyrics' = 'true'
    LIMIT 10
  `;
  console.log(`Found ${songsWithLrc.length} songs with lyrics/LRC:`);
  for (const s of songsWithLrc) {
    console.log(`- ID: ${s.id} | Title: "${s.title}"`);
    console.log(`  LRC Preview:`, s.lrc ? s.lrc.substring(0, 100) : 'null');
    console.log(`  Synced count:`, Array.isArray(s.synced) ? s.synced.length : typeof s.synced);
  }

  // Count total songs with LRC
  const [mCount] = await sql`SELECT count(*) FROM ministered_songs WHERE raw_data->>'karaokeLrcText' IS NOT NULL OR raw_data->'syncedLyrics' IS NOT NULL`;
  const [sCount] = await sql`SELECT count(*) FROM songs WHERE raw_data->>'karaokeLrcText' IS NOT NULL OR raw_data->'syncedLyrics' IS NOT NULL`;
  console.log(`\nTotals: ministered_songs with synced/LRC = ${mCount.count}, songs with synced/LRC = ${sCount.count}`);

  // Let's sample a few songs from ministered_songs to see all keys in raw_data
  const sample = await sql`SELECT id, title, raw_data FROM ministered_songs LIMIT 3`;
  console.log('\nSample ministered_songs raw_data keys:');
  for (const s of sample) {
    console.log(`ID: ${s.id}, Title: ${s.title}, keys:`, Object.keys(s.raw_data || {}));
    if (s.raw_data?.lyrics) console.log(`  lyrics length:`, s.raw_data.lyrics.length);
  }

  await sql.end();
}

inspectLyrics().catch(console.error);
