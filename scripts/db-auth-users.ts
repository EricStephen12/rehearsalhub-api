import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync } from 'fs';

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 25,
    ssl: 'require',
  });
  const lines: string[] = [];
  try {
    const publicMissing = ['users', 'refresh_tokens'];
    for (const name of publicMissing) {
      const exists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name=${name}
      `;
      lines.push(`public.${name}=${exists.length ? 'EXISTS' : 'MISSING'}`);
    }

    const authUsersCount = await sql`SELECT COUNT(*)::int AS c FROM auth.users`;
    lines.push(`auth.users rows=${authUsersCount[0].c}`);

    const authCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='auth' AND table_name='users'
      ORDER BY ordinal_position
    `;
    lines.push(`auth.users cols=${authCols.map((c) => c.column_name).join(',')}`);

    const sample = await sql`
      SELECT id, email, created_at, last_sign_in_at, is_anonymous,
             raw_app_meta_data, raw_user_meta_data
      FROM auth.users
      LIMIT 3
    `;
    for (const u of sample) {
      lines.push(
        `auth.user id=${u.id} email=${u.email} last=${u.last_sign_in_at} anon=${u.is_anonymous} app=${JSON.stringify(u.raw_app_meta_data).slice(0, 120)} meta_keys=${Object.keys((u.raw_user_meta_data as object) || {}).join(',')}`,
      );
    }

    // Compare profile ids vs auth.users ids
    const overlap = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM profiles) AS profiles,
        (SELECT COUNT(*)::int FROM auth.users) AS auth_users,
        (SELECT COUNT(*)::int FROM profiles p WHERE EXISTS (SELECT 1 FROM auth.users a WHERE a.id::text = p.id)) AS profiles_in_auth,
        (SELECT COUNT(*)::int FROM profiles p WHERE p.id ~ '^[A-Za-z0-9]{20,}$') AS profiles_firebase_like_ids
    `;
    lines.push(`OVERLAP ${JSON.stringify(overlap[0])}`);

    // roles distribution in profiles
    const roles = await sql`
      SELECT COALESCE(role,'(null)') AS role, COUNT(*)::int AS c
      FROM profiles GROUP BY role ORDER BY c DESC
    `;
    lines.push(`PROFILE_ROLES ${roles.map((r) => `${r.role}:${r.c}`).join(', ')}`);
  } catch (err) {
    lines.push(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await sql.end({ timeout: 3 });
  }
  writeFileSync('scripts/db-auth-users.txt', `${lines.join('\n')}\n`);
}

main();
