import 'dotenv/config';
import { db, rawPgClient } from './src/db';
import { attendance, adminRequests } from './src/schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('========================================');
  console.log('1. PG_CLASS ROW SECURITY STATUS');
  console.log('========================================');
  const pgClass = await rawPgClient`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('admin_requests', 'attendance')
    ORDER BY relname;
  `;
  console.log(JSON.stringify(pgClass, null, 2));

  console.log('\n========================================');
  console.log('2. ADMIN_REQUESTS TENANCY VERIFICATION');
  console.log('========================================');
  // User A (zone-088)
  const withoutHyphenA = 'zone088';
  const cleanZoneA = 'zone-088';
  const adminReqA = await db.select().from(adminRequests).where(
    sql`lower(replace(replace(${adminRequests.zoneId}, '-', ''), ' ', '')) = ${withoutHyphenA} OR 
        lower(${adminRequests.zoneId}) = ${cleanZoneA} OR 
        lower(replace(replace(${adminRequests.zoneCode}, '-', ''), ' ', '')) = ${withoutHyphenA} OR 
        lower(${adminRequests.zoneCode}) = ${cleanZoneA}`
  );
  console.log(`User A (zone-088) admin_requests count: ${adminReqA.length}`);
  console.log('User A sample rows:', adminReqA);

  // User B (zone-001)
  const withoutHyphenB = 'zone001';
  const cleanZoneB = 'zone-001';
  const adminReqB = await db.select().from(adminRequests).where(
    sql`lower(replace(replace(${adminRequests.zoneId}, '-', ''), ' ', '')) = ${withoutHyphenB} OR 
        lower(${adminRequests.zoneId}) = ${cleanZoneB} OR 
        lower(replace(replace(${adminRequests.zoneCode}, '-', ''), ' ', '')) = ${withoutHyphenB} OR 
        lower(${adminRequests.zoneCode}) = ${cleanZoneB}`
  );
  console.log(`User B (zone-001) admin_requests count: ${adminReqB.length}`);
  console.log('User B sample rows:', adminReqB);

  console.log('\n========================================');
  console.log('3. ATTENDANCE TENANCY VERIFICATION');
  console.log('========================================');
  // User A (zone-088)
  const attA = await db.select().from(attendance).where(
    sql`lower(replace(${attendance.zoneId}, '-', '')) = ${withoutHyphenA} OR 
        lower(${attendance.zoneId}) = ${cleanZoneA} OR
        lower(replace(${attendance.rawData}->>'zoneId', '-', '')) = ${withoutHyphenA} OR
        lower(replace(${attendance.rawData}->>'zone_id', '-', '')) = ${withoutHyphenA}`
  );
  console.log(`User A (zone-088) attendance count: ${attA.length}`);
  console.log('User A sample rows:', attA.slice(0, 3).map(r => ({ id: r.id, userName: r.userName, zoneId: r.zoneId, eventName: r.eventName })));

  // User B (zone-001)
  const attB = await db.select().from(attendance).where(
    sql`lower(replace(${attendance.zoneId}, '-', '')) = ${withoutHyphenB} OR 
        lower(${attendance.zoneId}) = ${cleanZoneB} OR
        lower(replace(${attendance.rawData}->>'zoneId', '-', '')) = ${withoutHyphenB} OR
        lower(replace(${attendance.rawData}->>'zone_id', '-', '')) = ${withoutHyphenB}`
  );
  console.log(`User B (zone-001) attendance count: ${attB.length}`);
  console.log('User B sample rows:', attB.slice(0, 3).map(r => ({ id: r.id, userName: r.userName, zoneId: r.zoneId, eventName: r.eventName })));

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
