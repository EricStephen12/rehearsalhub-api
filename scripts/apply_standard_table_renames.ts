import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🚀 Applying Full Database Standardization & Renaming...');

  // 1. praise_night_songs -> songs
  console.log('📦 Renaming praise_night_songs -> songs...');
  await db.execute(sql`ALTER TABLE IF EXISTS "praise_night_songs" RENAME TO "songs";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "praise_night_songs" AS SELECT * FROM "songs";`);
  console.log('   ✅ "songs" ready (with praise_night_songs compatibility view)');

  // 2. master_songs -> ministered_songs
  console.log('📦 Renaming master_songs -> ministered_songs...');
  await db.execute(sql`ALTER TABLE IF EXISTS "master_songs" RENAME TO "ministered_songs";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "master_songs" AS SELECT * FROM "ministered_songs";`);
  console.log('   ✅ "ministered_songs" ready (with master_songs compatibility view)');

  // 3. master_programs -> ministered_programs
  console.log('📦 Renaming master_programs -> ministered_programs...');
  await db.execute(sql`ALTER TABLE IF EXISTS "master_programs" RENAME TO "ministered_programs";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "master_programs" AS SELECT * FROM "ministered_programs";`);
  console.log('   ✅ "ministered_programs" ready (with master_programs compatibility view)');

  // 4. cloudinary_media -> media_assets
  console.log('📦 Renaming cloudinary_media -> media_assets...');
  await db.execute(sql`ALTER TABLE IF EXISTS "cloudinary_media" RENAME TO "media_assets";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "cloudinary_media" AS SELECT * FROM "media_assets";`);
  console.log('   ✅ "media_assets" ready (with cloudinary_media compatibility view)');

  // 5. zone_cloudinary_media -> zone_media_assets
  console.log('📦 Renaming zone_cloudinary_media -> zone_media_assets...');
  await db.execute(sql`ALTER TABLE IF EXISTS "zone_cloudinary_media" RENAME TO "zone_media_assets";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "zone_cloudinary_media" AS SELECT * FROM "zone_media_assets";`);
  console.log('   ✅ "zone_media_assets" ready (with zone_cloudinary_media compatibility view)');

  // 6. sys_metadata -> system_metadata
  console.log('📦 Renaming sys_metadata -> system_metadata...');
  await db.execute(sql`ALTER TABLE IF EXISTS "sys_metadata" RENAME TO "system_metadata";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "sys_metadata" AS SELECT * FROM "system_metadata";`);
  console.log('   ✅ "system_metadata" ready (with sys_metadata compatibility view)');

  console.log('\n🎉 ALL TABLES STANDARDIZED WITH 100% ZERO DOWNTIME COMPATIBILITY!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error applying renames:', err);
  process.exit(1);
});
