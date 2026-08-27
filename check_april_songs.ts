import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const songs = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_cat
    FROM songs
    WHERE lower(title) LIKE '%april%' OR lower(title) LIKE '%communion%';
  `;
  console.log('Songs found with April or Communion in title:', songs);

  const progSongs = await sql`
    SELECT s.id, s.title, s.category, s.praise_night_id, p.name as program_name
    FROM songs s
    JOIN programs p ON s.praise_night_id = p.id
    WHERE lower(p.name) LIKE '%april%';
  `;
  console.log(`Songs in April programs (${progSongs.length}):`);
  progSongs.forEach(s => {
    console.log(`- "${s.title}" in program "${s.program_name}" (category: "${s.category}")`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
