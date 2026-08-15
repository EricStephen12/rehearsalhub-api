/**
 * Align auth tables for Stage 3:
 * - auth_credentials (profile_id → profiles)
 * - refresh_tokens.user_id stores profiles.id (FK → profiles, not users)
 */
import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
  `;
  const names = new Set(cols.map((c) => String(c.column_name)));

  // Prefer stable physical column name user_id (value = profiles.id)
  if (names.has('profile_id') && !names.has('user_id')) {
    await sql`DELETE FROM refresh_tokens`;
    await sql`ALTER TABLE refresh_tokens RENAME COLUMN profile_id TO user_id`;
    console.log('renamed refresh_tokens.profile_id → user_id (stores profile ids)');
  }

  // Drop all FKs on refresh_tokens (legacy may point at public.users)
  await sql`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'refresh_tokens'
          AND c.contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE refresh_tokens DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END $$
  `;

  // Delete orphan tokens that are not profile ids (legacy users-table tokens)
  await sql`
    DELETE FROM refresh_tokens rt
    WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = rt.user_id)
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_user_id_profiles_fkey'
      ) THEN
        ALTER TABLE refresh_tokens
          ADD CONSTRAINT refresh_tokens_user_id_profiles_fkey
          FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
      END IF;
    END $$
  `;
  console.log('refresh_tokens.user_id FK → profiles(id)');

  await sql`
    CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
    ON refresh_tokens(user_id)
  `;

  const fks = await sql`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'refresh_tokens' AND c.contype = 'f'
  `;
  const profileCount = await sql`SELECT COUNT(*)::int AS c FROM profiles`;
  console.log('fks:', fks);
  console.log('profiles count:', profileCount[0]?.c);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
