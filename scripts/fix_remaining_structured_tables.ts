import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🔄 Completing structured migration for remaining tables...');

  // 1. Profiles (with email disambiguation for older duplicate test accounts)
  console.log('📦 Migrating profiles...');
  await db.execute(sql`
    WITH ranked_profiles AS (
      SELECT
        firestore_id,
        data,
        data->>'email' as raw_email,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(data->>'email') 
          ORDER BY (data->>'updated_at') DESC NULLS LAST, (data->>'created_at') DESC NULLS LAST
        ) as rn
      FROM firestore_export 
      WHERE collection_path = 'profiles'
    )
    INSERT INTO profiles (
      id, role, email, last_name, first_name, created_at, updated_at,
      kingschat_id, has_hq_access, profile_completed, raw_data
    )
    SELECT
      firestore_id,
      data->>'role',
      CASE 
        WHEN raw_email IS NULL OR raw_email = '' THEN NULL
        WHEN rn = 1 THEN raw_email
        ELSE split_part(raw_email, '@', 1) || '+old_' || substr(firestore_id, 1, 6) || '@' || split_part(raw_email, '@', 2)
      END,
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
    FROM ranked_profiles
    ON CONFLICT (id) DO UPDATE SET
      role = EXCLUDED.role, email = EXCLUDED.email,
      last_name = EXCLUDED.last_name, first_name = EXCLUDED.first_name,
      raw_data = EXCLUDED.raw_data;
  `);
  const profileCount = await db.execute(sql`SELECT count(*) FROM profiles`);
  console.log(`   ✅ profiles: ${(profileCount as any)[0].count} rows`);

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

  console.log('\n🎉 ALL structured tables successfully migrated with zero duplicates!');
  process.exit(0);
}

main().catch(console.error);
