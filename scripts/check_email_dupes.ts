import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  const dupes = await db.execute(sql`
    SELECT LOWER(data->>'email') as email, count(*), array_agg(firestore_id) as ids
    FROM firestore_export
    WHERE collection_path = 'profiles' AND data->>'email' IS NOT NULL AND data->>'email' != ''
    GROUP BY LOWER(data->>'email')
    HAVING count(*) > 1
  `);
  console.log('Duplicate emails in profiles:', JSON.stringify(dupes, null, 2));
  process.exit(0);
}

main().catch(console.error);
