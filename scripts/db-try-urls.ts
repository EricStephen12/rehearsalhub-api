import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync } from 'fs';

async function tryOne(label: string, url: string): Promise<boolean> {
  const host = new URL(url.replace(/^postgresql:/, 'http:').replace(/^postgres:/, 'http:')).host;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 20,
    ssl: 'require',
  });
  try {
    await sql`select 1 as ok`;
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const lines = [
      `OK ${label} host=${host}`,
      `TABLE_COUNT ${tables.length}`,
      `TABLES ${tables.map((t) => t.table_name).join(', ')}`,
    ];
    for (const t of tables) {
      const name = String(t.table_name);
      if (!/^[a-zA-Z0-9_]+$/.test(name)) continue;
      const rows = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${name}"`);
      lines.push(`ROW ${name}=${rows[0]?.c ?? '?'}`);
    }
    writeFileSync('scripts/db-live.txt', `${lines.join('\n')}\n`);
    await sql.end({ timeout: 2 });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeFileSync(
      'scripts/db-live.txt',
      `FAIL ${label} host=${host}\nERROR ${msg}\n`,
      { flag: 'a' },
    );
    try {
      await sql.end({ timeout: 1 });
    } catch {
      /* ignore */
    }
    return false;
  }
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL!;
  const u = new URL(raw.replace(/^postgresql:/, 'http:').replace(/^postgres:/, 'http:'));
  const ref = u.username.includes('.') ? u.username.split('.')[1] : '';
  const pass = encodeURIComponent(decodeURIComponent(u.password));

  writeFileSync('scripts/db-live.txt', `ref=${ref}\n`);

  const candidates: Array<[string, string]> = [
    ['env_as_is', raw],
    ['pooler_6543', `postgresql://${u.username}:${pass}@${u.hostname}:6543/postgres`],
    ['direct_db', `postgresql://postgres:${pass}@db.${ref}.supabase.co:5432/postgres`],
    ['pooler_plain_postgres', `postgresql://postgres:${pass}@${u.hostname}:5432/postgres`],
  ];

  for (const [label, url] of candidates) {
    const ok = await tryOne(label, url);
    if (ok) return;
  }
}

main();
