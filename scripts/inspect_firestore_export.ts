import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  const sample = await db.execute(sql`SELECT id, collection_path, firestore_id, migrated_at FROM firestore_export LIMIT 5`);
  console.log('Sample rows:', JSON.stringify(sample, null, 2));

  const counts = await db.execute(sql`
    SELECT collection_path, count(*) as count 
    FROM firestore_export 
    GROUP BY collection_path 
    ORDER BY count DESC 
    LIMIT 35
  `);
  console.log('Top collection counts in firestore_export:');
  for (const row of counts as any) {
    console.log(`- ${String(row.collection_path).padEnd(30)}: ${row.count} docs`);
  }

  // Check unique constraints and index on firestore_export
  const indexes = await db.execute(sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'firestore_export'
  `);
  console.log('\nIndexes on firestore_export:');
  for (const idx of indexes as any) {
    console.log(`- ${idx.indexname}: ${idx.indexdef}`);
  }

  process.exit(0);
}

main().catch(console.error);
