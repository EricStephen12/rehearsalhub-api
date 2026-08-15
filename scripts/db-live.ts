import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync, mkdirSync } from 'fs';

async function main(): Promise<void> {
  mkdirSync('scripts', { recursive: true });
  const lines: string[] = [];
  const url = process.env.DATABASE_URL;

  if (!url) {
    writeFileSync('scripts/db-live.txt', 'NO_DATABASE_URL\n');
    process.exit(1);
  }

  try {
    const u = new URL(url.replace(/^postgresql:/, 'http:').replace(/^postgres:/, 'http:'));
    lines.push(`host=${u.hostname}:${u.port || '5432'}`);
    lines.push(`db=${u.pathname}`);
    lines.push(`user=${u.username}`);
  } catch {
    lines.push('parse_error');
  }

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    ssl: 'require',
  });

  try {
    const ping = await sql`select current_database() as db, current_user as usr`;
    lines.push(`CONNECTED db=${ping[0].db} user=${ping[0].usr}`);

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    lines.push(`TABLE_COUNT ${tables.length}`);
    lines.push(`TABLES ${tables.map((t) => t.table_name).join(', ')}`);

    for (const t of tables) {
      const name = String(t.table_name);
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        lines.push(`ROW ${name}=SKIP_INVALID_NAME`);
        continue;
      }
      const rows = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${name}"`);
      lines.push(`ROW ${name}=${rows[0]?.c ?? '?'}`);
    }

    for (const name of [
      'profiles',
      'chats_v2',
      'messages_v2',
      'user_favorites',
      'subgroups',
      'zone_songs',
      'settings',
      'notifications',
      'users',
      'master_songs',
    ]) {
      const exists = tables.some((t) => t.table_name === name);
      if (!exists) {
        lines.push(`COLS ${name}=MISSING`);
        continue;
      }
      const cols = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position
      `;
      lines.push(
        `COLS ${name}=${cols.map((c) => `${c.column_name}:${c.data_type}`).join('|')}`,
      );
    }
  } catch (err) {
    lines.push(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      await sql.end({ timeout: 3 });
    } catch {
      /* ignore */
    }
  }

  writeFileSync('scripts/db-live.txt', `${lines.join('\n')}\n`);
}

main();
