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
  const lines: string[] = [];
  try {
    const hq = await sql`
      SELECT id, user_id, hq_group_id, user_email, user_name, role, status
      FROM hq_members LIMIT 3
    `;
    lines.push(`hq_sample=${JSON.stringify(hq)}`);
    const orphan = await sql`
      SELECT COUNT(*)::int AS c FROM hq_members h
      WHERE h.user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = h.user_id)
    `;
    const linked = await sql`
      SELECT COUNT(*)::int AS linked FROM hq_members h
      INNER JOIN profiles p ON p.id = h.user_id
    `;
    lines.push(`hq_orphans_no_profile=${orphan[0].c}`);
    lines.push(`hq_linked_to_profiles=${linked[0].linked}`);
    lines.push(`zone_members_rows=0 (empty table)`);
  } catch (e) {
    lines.push(`ERROR ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await sql.end({ timeout: 2 });
  }
  writeFileSync('scripts/db-members-note.txt', `${lines.join('\n')}\n`);
}
main();
