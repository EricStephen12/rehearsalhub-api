import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './src/db';
import { profiles } from './src/schema';

async function main() {
  const p = await db.select().from(profiles).where(eq(profiles.email, 'takeshopstores@gmail.com')).limit(1);
  console.log(p[0]?.id);
  console.log(JSON.stringify(p[0]?.rawData, null, 2));
  process.exit(0);
}

main().catch(console.error);
