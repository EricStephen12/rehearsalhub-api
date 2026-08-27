import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('=== 1. CATEGORIES TABLE CONTENT ===');
  const cats = await sql`SELECT * FROM categories;`;
  console.log(cats);

  console.log('\n=== 2. "April Global Communion" SONGS ===');
  const aprilSongs = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_category, raw_data->>'categories' as raw_categories, raw_data
    FROM songs
    WHERE lower(title) LIKE '%april%global%' OR lower(title) LIKE '%global%communion%' OR lower(title) LIKE '%april%';
  `;
  console.log(`Found ${aprilSongs.length} songs:`);
  aprilSongs.forEach(s => {
    console.log({
      id: s.id,
      title: s.title,
      column_category: s.category,
      raw_category: s.raw_category,
      raw_categories: s.raw_categories,
    });
  });

  console.log('\n=== 3. ALL SONGS WITH category = "Other" ===');
  const otherSongs = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_category
    FROM songs
    WHERE category = 'Other' OR raw_data->>'category' = 'Other'
    ORDER BY title;
  `;
  console.log(`Found ${otherSongs.length} songs with category = 'Other':`);
  console.log(otherSongs.map(s => `[${s.id}] "${s.title}" (col: ${s.category}, raw: ${s.raw_category})`));

  console.log('\n=== 4. ALL MINISTERED_SONGS WITH category = "Other" ===');
  const otherMinSongs = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_category
    FROM ministered_songs
    WHERE category = 'Other' OR raw_data->>'category' = 'Other'
    ORDER BY title;
  `;
  console.log(`Found ${otherMinSongs.length} ministered_songs with category = 'Other':`);
  console.log(otherMinSongs.map(s => `[${s.id}] "${s.title}" (col: ${s.category}, raw: ${s.raw_category})`));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
