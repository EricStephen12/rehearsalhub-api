import 'dotenv/config';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  const res = await db.execute(sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'programs' 
    ORDER BY ordinal_position;
  `);
  console.log('--- columns of programs ---');
  console.log(res);

  const resSongs = await db.execute(sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'songs' 
    ORDER BY ordinal_position;
  `);
  console.log('--- columns of songs ---');
  console.log(resSongs);

  process.exit(0);
}

main().catch(console.error);
