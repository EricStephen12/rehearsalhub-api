require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 2, ssl: 'require', prepare: false });

async function run() {
  console.log('=== PROFILES SAMPLE WITH ZONE INFO ===');
  const profs = await sql`
    SELECT id, first_name, last_name, email, role, has_hq_access, 
           raw_data->>'zone_code' as zone_code,
           raw_data->>'zoneCode' as zone_code2,
           raw_data->>'zoneId' as zone_id,
           raw_data->>'zoneName' as zone_name,
           raw_data->>'is_active' as is_active,
           raw_data->>'status' as status
    FROM profiles 
    LIMIT 30
  `;
  console.log('Profiles:', JSON.stringify(profs, null, 2));

  console.log('=== DISTINCT ZONE CODES IN PROFILES ===');
  const distinctZones = await sql`
    SELECT DISTINCT 
      raw_data->>'zone_code' as zone_code,
      raw_data->>'zoneId' as zone_id,
      count(*) as count
    FROM profiles
    GROUP BY raw_data->>'zone_code', raw_data->>'zoneId'
  `;
  console.log('Distinct Zones in Profiles:', JSON.stringify(distinctZones, null, 2));

  console.log('=== ZONE_MEMBERS TABLE CHECK ===');
  try {
    const zm = await sql`SELECT * FROM zone_members LIMIT 10`;
    console.log('zone_members:', JSON.stringify(zm, null, 2));
  } catch (e) {
    console.log('No zone_members table or error:', e.message);
  }

  console.log('=== HQ_MEMBERS TABLE CHECK ===');
  try {
    const hm = await sql`SELECT * FROM hq_members LIMIT 10`;
    console.log('hq_members:', JSON.stringify(hm, null, 2));
  } catch (e) {
    console.log('No hq_members table or error:', e.message);
  }

  console.log('=== DISTINCT ZONE_IDS IN PROGRAMS ===');
  const distinctProgZones = await sql`
    SELECT DISTINCT 
      zone_id,
      category,
      status,
      count(*) as count
    FROM programs
    GROUP BY zone_id, category, status
  `;
  console.log('Distinct Prog Zones:', JSON.stringify(distinctProgZones, null, 2));

  await sql.end();
}

run().catch(console.error);
