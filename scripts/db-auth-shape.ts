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
    // All public tables that look identity-related
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND (
          table_name ILIKE '%user%'
          OR table_name ILIKE '%auth%'
          OR table_name ILIKE '%session%'
          OR table_name ILIKE '%profile%'
          OR table_name ILIKE '%member%'
          OR table_name ILIKE '%kingschat%'
          OR table_name ILIKE '%token%'
        )
      ORDER BY table_name
    `;
    lines.push(`IDENTITY_TABLES ${tables.map((t) => t.table_name).join(', ')}`);

    for (const t of tables) {
      const name = String(t.table_name);
      const cols = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position
      `;
      const count = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${name}"`);
      lines.push(`TABLE ${name} rows=${count[0].c}`);
      lines.push(`  COLS ${cols.map((c) => `${c.column_name}:${c.data_type}`).join('|')}`);
    }

    // Sample profiles (no secrets beyond email/role)
    const profileSamples = await sql`
      SELECT id, email, first_name, last_name, role, has_hq_access, kingschat_id,
             profile_completed, jsonb_object_keys(COALESCE(raw_data, '{}'::jsonb)) AS raw_keys
      FROM profiles
      LIMIT 3
    `;
    // better: one query for samples + raw_data keys separately
    const profiles = await sql`
      SELECT id, email, first_name, last_name, role, has_hq_access, kingschat_id, profile_completed, raw_data
      FROM profiles
      LIMIT 3
    `;
    for (const p of profiles) {
      const raw = (p.raw_data && typeof p.raw_data === 'object' ? p.raw_data : {}) as Record<
        string,
        unknown
      >;
      lines.push(
        `PROFILE_SAMPLE id=${p.id} email=${p.email} role=${p.role} hq=${p.has_hq_access} kc=${p.kingschat_id} keys=${Object.keys(raw).slice(0, 40).join(',')}`,
      );
    }

    // user_sessions sample
    const sessCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_sessions' ORDER BY ordinal_position
    `;
    if (sessCols.length) {
      const sessions = await sql`SELECT * FROM user_sessions LIMIT 2`;
      for (const s of sessions) {
        const keys = Object.keys(s);
        lines.push(`SESSION_SAMPLE keys=${keys.join(',')}`);
        lines.push(
          `  id=${(s as any).id} user_id=${(s as any).user_id ?? (s as any).userId} raw_keys=${Object.keys(((s as any).raw_data || {}) as object).slice(0, 30).join(',')}`,
        );
      }
    }

    // kingschat_auth_sessions
    const kc = await sql`SELECT * FROM kingschat_auth_sessions LIMIT 2`;
    for (const row of kc) {
      lines.push(`KC_SESSION keys=${Object.keys(row).join(',')}`);
      const raw = ((row as any).raw_data || {}) as Record<string, unknown>;
      lines.push(`  id=${(row as any).id} raw_keys=${Object.keys(raw).slice(0, 30).join(',')}`);
    }

    // chat_users (huge) — shape only
    const cuCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='chat_users' ORDER BY ordinal_position
    `;
    lines.push(`chat_users COLS ${cuCols.map((c) => c.column_name).join(',')}`);
    const cu = await sql`SELECT * FROM chat_users LIMIT 1`;
    if (cu[0]) {
      const raw = ((cu[0] as any).raw_data || {}) as Record<string, unknown>;
      lines.push(
        `chat_users SAMPLE id=${(cu[0] as any).id} keys=${Object.keys(cu[0]).join(',')} raw_keys=${Object.keys(raw).slice(0, 40).join(',')}`,
      );
    }

    // Is there password_hash anywhere?
    const pwCols = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND (column_name ILIKE '%password%' OR column_name ILIKE '%hash%' OR column_name ILIKE '%jwt%' OR column_name ILIKE '%refresh%')
      ORDER BY table_name, column_name
    `;
    lines.push(
      `PASSWORD_OR_TOKEN_COLS ${pwCols.map((c) => `${c.table_name}.${c.column_name}`).join(', ') || 'NONE'}`,
    );

    // auth schema?
    const authTables = await sql`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('auth', 'supabase_auth') AND table_type='BASE TABLE'
      ORDER BY table_schema, table_name
    `;
    lines.push(
      `AUTH_SCHEMA_TABLES ${authTables.map((t) => `${t.table_schema}.${t.table_name}`).join(', ') || 'NONE'}`,
    );
  } catch (err) {
    lines.push(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await sql.end({ timeout: 3 });
  }

  writeFileSync('scripts/db-auth-shape.txt', `${lines.join('\n')}\n`);
}

main();
