import 'dotenv/config';
import { db } from '../src/db';
import { songs, ministeredSongs, chats, messages, schedulePrograms, profiles } from '../src/schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🧪 Testing End-to-End Query Verification on New Standard Tables...\n');

  const songRows = await db.select({ id: songs.id, title: songs.title }).from(songs).limit(3);
  console.log('✅ songs (Main Repertoire):', songRows);

  const ministeredRows = await db.select({ id: ministeredSongs.id, title: ministeredSongs.title }).from(ministeredSongs).limit(3);
  console.log('✅ ministered_songs (Ministered Catalog):', ministeredRows);

  const chatRows = await db.select({ id: chats.id, type: chats.type }).from(chats).limit(3);
  console.log('✅ chats (Active Conversations):', chatRows);

  const msgRows = await db.select({ id: messages.id, text: messages.text }).from(messages).limit(3);
  console.log('✅ messages (Active Messages):', msgRows);

  const schedRows = await db.select({ id: schedulePrograms.id, name: schedulePrograms.name }).from(schedulePrograms).limit(3);
  console.log('✅ schedule_programs:', schedRows);

  const profRows = await db.select({ id: profiles.id, email: profiles.email, role: profiles.role }).from(profiles).limit(3);
  console.log('✅ profiles:', profRows);

  console.log('\n🎉 ALL STANDARD TABLE QUERIES VERIFIED 100% OPERATIONAL!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
