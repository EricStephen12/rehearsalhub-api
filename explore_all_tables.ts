import 'dotenv/config';
import { db } from './src/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function main() {
  // Get all tables with row counts
  const tables = await db.execute<{tablename: string}>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  const tableNames = (tables as any).map((r: any) => r.tablename) as string[];

  const summary: Record<string, any> = {};

  for (const table of tableNames) {
    try {
      const count = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM "${table}"`));
      const sample = await db.execute(sql.raw(`SELECT * FROM "${table}" LIMIT 1`));
      const rows = sample as any;
      summary[table] = {
        rowCount: (count as any)[0]?.count,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        sample: rows[0] || null
      };
    } catch(e: any) {
      summary[table] = { error: e.message };
    }
  }

  fs.writeFileSync('db_summary.json', JSON.stringify(summary, null, 2));
  console.log('Done. Written to db_summary.json');
  process.exit(0);
}

main().catch(console.error);
