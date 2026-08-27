import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('====================================================');
  console.log('1. INSPECT CATEGORIES TABLE & SCHEMA');
  console.log('====================================================');
  const catCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'categories';
  `;
  console.log('categories columns:', catCols.map(c => c.column_name));

  const allCategories = await sql`SELECT * FROM categories;`;
  console.log(`All rows in categories table (${allCategories.length}):`, allCategories);

  console.log('\n====================================================');
  console.log('2. SEARCHING FOR "April Global Communion"');
  console.log('====================================================');
  const songSearch = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_cat, raw_data->'categories' as raw_cats, raw_data
    FROM songs 
    WHERE lower(title) LIKE '%april%' OR lower(title) LIKE '%communion%' OR lower(title) LIKE '%global communion%';
  `;
  console.log(`Songs table matching (${songSearch.length}):`);
  songSearch.forEach(s => {
    console.log({
      id: s.id,
      title: s.title,
      category_col: s.category,
      raw_cat: s.raw_cat,
      raw_cats: s.raw_cats,
      programId: s.raw_data?.programId || s.raw_data?.praiseNightId,
      full_raw: s.raw_data,
    });
  });

  const minSearch = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_cat, raw_data->'categories' as raw_cats, raw_data
    FROM ministered_songs 
    WHERE lower(title) LIKE '%april%' OR lower(title) LIKE '%communion%' OR lower(title) LIKE '%global communion%';
  `;
  console.log(`\nMinistered_songs matching (${minSearch.length}):`);
  minSearch.forEach(s => {
    console.log({
      id: s.id,
      title: s.title,
      category_col: s.category,
      raw_cat: s.raw_cat,
      raw_cats: s.raw_cats,
      full_raw: s.raw_data,
    });
  });

  const zoneSearch = await sql`
    SELECT id, title, category, raw_data->>'category' as raw_cat, raw_data->'categories' as raw_cats, zone_id, raw_data
    FROM zone_songs 
    WHERE lower(title) LIKE '%april%' OR lower(title) LIKE '%communion%' OR lower(title) LIKE '%global communion%';
  `;
  console.log(`\nZone_songs matching (${zoneSearch.length}):`);
  zoneSearch.forEach(s => {
    console.log({
      id: s.id,
      title: s.title,
      category_col: s.category,
      raw_cat: s.raw_cat,
      raw_cats: s.raw_cats,
      zoneId: s.zone_id,
      full_raw: s.raw_data,
    });
  });

  console.log('\n====================================================');
  console.log('3. DISTINCT CATEGORY VALUES ACROSS SONGS TABLE');
  console.log('====================================================');
  const distinctSongsCats = await sql`
    SELECT category, count(*) as count
    FROM songs
    GROUP BY category
    ORDER BY count DESC;
  `;
  console.log('Songs table distinct category column:', distinctSongsCats);

  const distinctSongsRawCats = await sql`
    SELECT raw_data->>'category' as raw_cat, count(*) as count
    FROM songs
    GROUP BY raw_data->>'category'
    ORDER BY count DESC;
  `;
  console.log('Songs table distinct raw_data->>category:', distinctSongsRawCats);

  console.log('\n====================================================');
  console.log('4. PROGRAMS / REHEARSALS SEARCH');
  console.log('====================================================');
  const progMatches = await sql`
    SELECT id, name, category, scope, zone_id, raw_data
    FROM programs
    WHERE lower(name) LIKE '%april%' OR lower(name) LIKE '%communion%' OR lower(name) LIKE '%global%';
  `;
  console.log(`Programs matching (${progMatches.length}):`);
  progMatches.forEach(p => {
    console.log({
      id: p.id,
      name: p.name,
      category: p.category,
      scope: p.scope,
      zone_id: p.zone_id,
      raw_category: p.raw_data?.category,
      raw_categories: p.raw_data?.categories,
    });
  });

  console.log('\n====================================================');
  console.log('5. ALL DISTINCT CATEGORIES ACROSS ALL SONGS IN DB');
  console.log('====================================================');
  const allSongCategories = await sql`
    SELECT DISTINCT COALESCE(category, raw_data->>'category', '(null/empty)') as cat_val, count(*) as count
    FROM (
      SELECT category, raw_data FROM songs
      UNION ALL
      SELECT category, raw_data FROM zone_songs
      UNION ALL
      SELECT category, raw_data FROM ministered_songs
    ) t
    GROUP BY COALESCE(category, raw_data->>'category', '(null/empty)')
    ORDER BY count DESC;
  `;
  console.log('All song category values across all 3 tables:', allSongCategories);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
