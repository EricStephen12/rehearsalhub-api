import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync } from 'fs';

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 20,
    ssl: 'require',
  });
  const names = [
    'profiles',
    'chats_v2',
    'messages_v2',
    'user_favorites',
    'subgroups',
    'zone_songs',
    'settings',
    'notifications',
    'users',
    'zone_members',
    'hq_members',
  ];
  const lines: string[] = [];
  try {
    for (const name of names) {
      const cols = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position
      `;
      if (!cols.length) {
        lines.push(`${name}=MISSING`);
        continue;
      }
      lines.push(`${name}=${cols.map((c) => c.column_name).join(',')}`);
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
  writeFileSync('scripts/db-cols.txt', `${lines.join('\n')}\n`);
}

main();
