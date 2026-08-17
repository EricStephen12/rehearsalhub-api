import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db } from './src/db';
import { zoneMembers, hqMembers, profiles } from './src/schema';

async function main() {
  const email = 'takeshopstores@gmail.com';
  const p = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
  const user = p[0];
  if (!user) { console.log('User not found'); process.exit(1); }

  console.log('=== PROFILE ===');
  console.log('id:', user.id);
  console.log('rawData:', JSON.stringify(user.rawData, null, 2));

  const zm = await db.select().from(zoneMembers).where(eq(zoneMembers.userId, user.id));
  console.log('\n=== ZONE_MEMBERS rows for user ===', JSON.stringify(zm, null, 2));

  const hqm = await db.select().from(hqMembers).where(eq(hqMembers.userId, user.id));
  console.log('\n=== HQ_MEMBERS rows for user ===', JSON.stringify(hqm, null, 2));

  // Check a sample of zone_members to see what status values look like (e.g. 'active', 'inactive', 'left')
  const allZm = await db.execute<any>(sql`SELECT DISTINCT status FROM zone_members`);
  console.log('\n=== DISTINCT status values in zone_members ===', JSON.stringify(allZm, null, 2));

  const allHqm = await db.execute<any>(sql`SELECT DISTINCT status FROM hq_members`);
  console.log('\n=== DISTINCT status values in hq_members ===', JSON.stringify(allHqm, null, 2));

  // Check a sample of user_groups (might store membership)
  const ug = await db.execute<any>(sql`SELECT * FROM user_groups WHERE raw_data::text LIKE '%${sql.raw(user.id)}%' LIMIT 5`);
  console.log('\n=== user_groups rows with userId ===', JSON.stringify(ug, null, 2));

  process.exit(0);
}

main().catch(console.error);
