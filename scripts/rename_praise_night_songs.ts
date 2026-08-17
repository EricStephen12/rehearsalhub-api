import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🚀 Renaming praise_night_songs to songs...');

  // 1. Rename table to standard 'songs'
  await db.execute(sql`ALTER TABLE IF EXISTS "praise_night_songs" RENAME TO "songs";`);
  console.log('   ✅ Table renamed to "songs"');

  // 2. Create backward-compatible view for 'praise_night_songs'
  await db.execute(sql`CREATE OR REPLACE VIEW "praise_night_songs" AS SELECT * FROM "songs";`);
  console.log('   ✅ Backward-compatibility view "praise_night_songs" created');

  console.log('\n🎉 Rename complete: "songs" is now the primary standard table!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error renaming:', err);
  process.exit(1);
});
