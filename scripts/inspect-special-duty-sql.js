require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  console.log('=== 1. CHECKING ZONE_MEMBERS FOR ZONE-088 / DUTY ===');
  const zm = await sql`
    SELECT id, user_id, zone_id, role, status, created_at, raw_data 
    FROM zone_members 
    WHERE zone_id ILIKE '%088%' OR zone_id ILIKE '%duty%' OR zone_id ILIKE '%special%'
  `;
  console.log(`Found ${zm.length} in zone_members:`, JSON.stringify(zm, null, 2));

  console.log('\n=== 2. CHECKING HQ_MEMBERS FOR ZONE-088 / DUTY ===');
  const hm = await sql`
    SELECT id, user_id, hq_group_id, role, status, created_at, user_name, user_email, raw_data 
    FROM hq_members 
    WHERE hq_group_id ILIKE '%088%' OR hq_group_id ILIKE '%duty%' OR hq_group_id ILIKE '%special%'
  `;
  console.log(`Found ${hm.length} in hq_members:`, JSON.stringify(hm, null, 2));

  console.log('\n=== 3. CHECKING PROFILES FOR ZONE-088 / DUTY / SPECIAL ===');
  const profs = await sql`
    SELECT id, first_name, last_name, email, role, has_hq_access, 
           raw_data->>'zone_code' as zone_code,
           raw_data->>'zoneCode' as zone_code_alt,
           raw_data->>'zoneId' as zone_id,
           raw_data->>'zoneName' as zone_name,
           raw_data->>'status' as status,
           raw_data->>'is_active' as is_active
    FROM profiles 
    WHERE raw_data->>'zone_code' ILIKE '%088%' 
       OR raw_data->>'zone_code' ILIKE '%duty%'
       OR raw_data->>'zoneCode' ILIKE '%088%'
       OR raw_data->>'zoneCode' ILIKE '%duty%'
       OR raw_data->>'zoneId' ILIKE '%088%'
       OR raw_data->>'zoneId' ILIKE '%duty%'
       OR raw_data->>'zoneName' ILIKE '%duty%'
  `;
  console.log(`Found ${profs.length} in profiles:`, JSON.stringify(profs, null, 2));

  console.log('\n=== 4. CHECKING PROGRAMS FOR ZONE-088 / DUTY ===');
  const progs = await sql`
    SELECT id, name, category, status, zone_id, date 
    FROM programs 
    WHERE zone_id ILIKE '%088%' OR zone_id ILIKE '%duty%' OR zone_id ILIKE '%special%'
  `;
  console.log(`Found ${progs.length} in programs:`, JSON.stringify(progs, null, 2));

  console.log('\n=== 5. CHECKING ZONE_PROGRAMS FOR ZONE-088 / DUTY ===');
  try {
    const zp = await sql`
      SELECT id, name, category, status, zone_id 
      FROM zone_programs 
      WHERE zone_id ILIKE '%088%' OR zone_id ILIKE '%duty%' OR zone_id ILIKE '%special%'
    `;
    console.log(`Found ${zp.length} in zone_programs:`, JSON.stringify(zp, null, 2));
  } catch (e) {
    console.log('zone_programs error/empty:', e.message);
  }

  console.log('\n=== 6. CHECKING SONGS FOR ZONE-088 / DUTY ===');
  const sngs = await sql`
    SELECT id, title, praise_night_id, zone_id, category 
    FROM songs 
    WHERE zone_id ILIKE '%088%' OR zone_id ILIKE '%duty%' OR zone_id ILIKE '%special%'
  `;
  console.log(`Found ${sngs.length} in songs:`, JSON.stringify(sngs, null, 2));

  await sql.end();
}

run().catch(console.error);
