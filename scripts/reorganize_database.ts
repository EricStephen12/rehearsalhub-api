import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🚀 Starting Database Reorganization & Clean-Up...');

  // 1. Archive legacy tables
  console.log('📦 Archiving unused legacy tables...');
  await db.execute(sql`ALTER TABLE IF EXISTS "chats" RENAME TO "legacy_chats";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "messages" RENAME TO "legacy_messages";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "songs" RENAME TO "legacy_songs";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "media" RENAME TO "legacy_storage_media";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "whatsapp_users" RENAME TO "legacy_whatsapp_users";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "admin_playlists" RENAME TO "legacy_admin_playlists";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "schedule_songs" RENAME TO "legacy_schedule_songs";`);
  console.log('   ✅ Legacy tables safely archived');

  // 2. Promote _v2 tables to primary standard names
  console.log('📦 Promoting _v2 tables to standard clean names...');
  await db.execute(sql`ALTER TABLE IF EXISTS "chats_v2" RENAME TO "chats";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "messages_v2" RENAME TO "messages";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "calls_v2" RENAME TO "calls";`);
  await db.execute(sql`ALTER TABLE IF EXISTS "statuses_v2" RENAME TO "user_statuses";`);
  console.log('   ✅ Tables promoted: chats, messages, calls, user_statuses');

  // 3. Create backward-compatibility views so existing apps/APIs continue working seamlessly
  console.log('📦 Creating zero-downtime backward compatibility views...');
  await db.execute(sql`CREATE OR REPLACE VIEW "chats_v2" AS SELECT * FROM "chats";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "messages_v2" AS SELECT * FROM "messages";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "calls_v2" AS SELECT * FROM "calls";`);
  await db.execute(sql`CREATE OR REPLACE VIEW "statuses_v2" AS SELECT * FROM "user_statuses";`);
  console.log('   ✅ Backward compatibility views created');

  console.log('\n🎉 DATABASE REORGANIZATION COMPLETED SUCCESSFULLY!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Reorganization error:', err);
  process.exit(1);
});
