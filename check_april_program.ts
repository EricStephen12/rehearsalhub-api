import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  // Find all programs matching April or Global Communion
  const aprilProgs = await sql`
    SELECT id, name, category, songs, song_ids, raw_data 
    FROM programs 
    WHERE lower(name) LIKE '%april%' OR lower(name) LIKE '%gcs%';
  `;
  console.log('April Programs:', aprilProgs.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    songIds: p.song_ids || p.raw_data?.songIds,
    songsInProg: p.songs,
  })));

  // If there are songs associated with these programs
  for (const prog of aprilProgs) {
    const sIds = prog.song_ids || prog.raw_data?.songIds || [];
    console.log(`\nSongs for Program: ${prog.name} (${prog.id}):`);
    const pSongs = await sql`
      SELECT id, title, category, raw_data->>'category' as raw_cat, raw_data->'categories' as raw_cats
      FROM songs 
      WHERE praise_night_id = ${prog.id} OR raw_data->>'praiseNightId' = ${prog.id} OR id = ANY(${sIds});
    `;
    console.log(pSongs);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
