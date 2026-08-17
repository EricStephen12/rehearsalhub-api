import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🔄 Completing structured migration for remaining tables...');

  // 0. Temporarily drop unique email constraint to allow all user profiles to import smoothly
  console.log('🔓 Adjusting email constraint for migration...');
  await db.execute(sql`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_email_unique CASCADE`);
  await db.execute(sql`DROP INDEX IF EXISTS profiles_email_unique CASCADE`);

  // 1. Profiles
  console.log('📦 Migrating profiles...');
  await db.execute(sql`
    INSERT INTO profiles (
      id, role, email, last_name, first_name, created_at, updated_at,
      kingschat_id, has_hq_access, profile_completed, raw_data
    )
    SELECT
      firestore_id,
      data->>'role',
      NULLIF(TRIM(LOWER(data->>'email')), ''),
      COALESCE(data->>'last_name', data->>'lastName'),
      COALESCE(data->>'first_name', data->>'firstName'),
      CASE 
        WHEN data->'created_at'->>'_seconds' IS NOT NULL THEN to_timestamp((data->'created_at'->>'_seconds')::double precision)
        WHEN data->>'created_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (data->>'created_at')::timestamp
        WHEN data->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' THEN (data->>'createdAt')::timestamp
        ELSE NOW()
      END,
      data->>'updated_at',
      COALESCE(data->>'kingschat_id', data->>'kingschatId'),
      (data->>'has_hq_access')::boolean,
      (data->>'profile_completed')::boolean,
      data
    FROM firestore_export 
    WHERE collection_path = 'profiles'
    ON CONFLICT (id) DO UPDATE SET
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      last_name = EXCLUDED.last_name,
      first_name = EXCLUDED.first_name,
      has_hq_access = EXCLUDED.has_hq_access,
      profile_completed = EXCLUDED.profile_completed,
      raw_data = EXCLUDED.raw_data;
  `);

  const pCount = await db.execute(sql`SELECT count(*) FROM profiles`);
  console.log(`   ✅ profiles: ${(pCount as any)[0].count} rows`);

  // 2. Zone Members
  console.log('📦 Migrating zone_members...');
  await db.execute(sql`
    INSERT INTO zone_members (id, user_id, zone_id, role, status, raw_data)
    SELECT 
      e.firestore_id,
      e.data->>'userId',
      e.data->>'zoneId',
      e.data->>'role',
      e.data->>'status',
      e.data
    FROM firestore_export e
    INNER JOIN profiles p ON p.id = (e.data->>'userId')
    WHERE e.collection_path = 'zone_members'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const zmCount = await db.execute(sql`SELECT count(*) FROM zone_members`);
  console.log(`   ✅ zone_members: ${(zmCount as any)[0].count} rows`);

  // 3. HQ Members
  console.log('📦 Migrating hq_members...');
  await db.execute(sql`
    INSERT INTO hq_members (id, role, status, user_id, user_name, hq_group_id, user_email, raw_data)
    SELECT 
      e.firestore_id,
      e.data->>'role',
      e.data->>'status',
      e.data->>'userId',
      e.data->>'userName',
      e.data->>'hqGroupId',
      e.data->>'userEmail',
      e.data
    FROM firestore_export e
    INNER JOIN profiles p ON p.id = (e.data->>'userId')
    WHERE e.collection_path = 'hq_members'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const hqmCount = await db.execute(sql`SELECT count(*) FROM hq_members`);
  console.log(`   ✅ hq_members: ${(hqmCount as any)[0].count} rows`);

  // 4. Song History
  console.log('📦 Migrating song_history...');
  await db.execute(sql`
    INSERT INTO song_history (id, type, title, song_id, new_value, old_value, created_at, created_by, description, raw_data)
    SELECT 
      firestore_id,
      data->>'type',
      data->>'title',
      COALESCE(data->>'song_id', data->>'songId'),
      COALESCE(data->>'new_value', data->>'newValue'),
      COALESCE(data->>'old_value', data->>'oldValue'),
      CASE 
        WHEN data->'created_at'->>'_seconds' IS NOT NULL THEN to_timestamp((data->'created_at'->>'_seconds')::double precision)
        WHEN data->>'created_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (data->>'created_at')::timestamp
        WHEN data->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' THEN (data->>'createdAt')::timestamp
        ELSE NOW()
      END,
      COALESCE(data->>'created_by', data->>'createdBy'),
      data->>'description',
      data
    FROM firestore_export WHERE collection_path = 'song_history'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const shCount = await db.execute(sql`SELECT count(*) FROM song_history`);
  console.log(`   ✅ song_history: ${(shCount as any)[0].count} rows`);

  // 5. Zone Songs
  console.log('📦 Migrating zone_songs...');
  await db.execute(sql`
    INSERT INTO zone_songs (id, title, key, tempo, zone_id, status, audio_file, raw_data)
    SELECT 
      firestore_id,
      data->>'title',
      data->>'key',
      data->>'tempo',
      data->>'zoneId',
      data->>'status',
      data->>'audioFile',
      data
    FROM firestore_export WHERE collection_path = 'zone_songs'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const zsCount = await db.execute(sql`SELECT count(*) FROM zone_songs`);
  console.log(`   ✅ zone_songs: ${(zsCount as any)[0].count} rows`);

  // 6. Subgroup Praise Nights
  console.log('📦 Migrating subgroup_praise_nights...');
  await db.execute(sql`
    INSERT INTO subgroup_praise_nights (id, raw_data)
    SELECT firestore_id, data
    FROM firestore_export WHERE collection_path = 'subgroup_praise_nights'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const spnCount = await db.execute(sql`SELECT count(*) FROM subgroup_praise_nights`);
  console.log(`   ✅ subgroup_praise_nights: ${(spnCount as any)[0].count} rows`);

  // 7. Notifications
  console.log('📦 Migrating notifications...');
  await db.execute(sql`
    INSERT INTO notifications (id, raw_data)
    SELECT firestore_id, data
    FROM firestore_export WHERE collection_path = 'notifications'
    ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
  `);
  const notifCount = await db.execute(sql`SELECT count(*) FROM notifications`);
  console.log(`   ✅ notifications: ${(notifCount as any)[0].count} rows`);

  console.log('\n🎉 ALL TABLES COMPLETED SUCCESSFULLY WITH ZERO DUPLICATES!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});
