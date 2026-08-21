require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function testQuery(targetZone) {
  const rawClean = targetZone.toLowerCase().replace(/[^a-z0-9]/g, '');
  const withHyphen = targetZone.includes('-') ? targetZone.toLowerCase() : targetZone.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');
  const withoutHyphen = targetZone.replace(/-/g, '').toLowerCase();

  console.log(`\nTesting targetZone = "${targetZone}" (withHyphen: "${withHyphen}", withoutHyphen: "${withoutHyphen}")`);

  const zm = await sql`
    SELECT count(*) as count 
    FROM zone_members 
    WHERE lower(replace(zone_id, '-', '')) = ${withoutHyphen} OR lower(zone_id) = ${withHyphen}
  `;
  console.log('zone_members matched:', zm[0].count);

  const hm = await sql`
    SELECT count(*) as count 
    FROM hq_members 
    WHERE lower(replace(hq_group_id, '-', '')) = ${withoutHyphen} OR lower(hq_group_id) = ${withHyphen}
  `;
  console.log('hq_members matched:', hm[0].count);

  const profs = await sql`
    SELECT count(*) as count 
    FROM profiles 
    WHERE lower(replace(raw_data->>'zone_code', '-', '')) = ${withoutHyphen} 
       OR lower(replace(raw_data->>'zoneCode', '-', '')) = ${withoutHyphen}
       OR lower(replace(raw_data->>'zoneId', '-', '')) = ${withoutHyphen}
       OR lower(replace(raw_data->>'zone_id', '-', '')) = ${withoutHyphen}
       OR lower(raw_data->>'zone_code') = ${withHyphen}
       OR lower(raw_data->>'zoneId') = ${withHyphen}
  `;
  console.log('profiles matched:', profs[0].count);
}

async function run() {
  await testQuery('ZONE088');
  await testQuery('zone-088');
  await testQuery('ZONE005');
  await testQuery('zone-005');
  await testQuery('ZONEORCH');
  await testQuery('zone-orchestra');
  await sql.end();
}

run().catch(console.error);
