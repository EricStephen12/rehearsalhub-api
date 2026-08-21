require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  console.log('=== OFFER 7 IN programs TABLE ===');
  const pOffer7 = await sql`
    SELECT id, name, category, status, zone_id, date, created_at, raw_data 
    FROM programs 
    WHERE name ILIKE '%offer 7%' OR name ILIKE '%offer7%'
  `;
  console.log('programs table:', JSON.stringify(pOffer7, null, 2));

  console.log('\n=== OFFER 7 IN zone_programs TABLE ===');
  const zpOffer7 = await sql`
    SELECT id, name, category, status, zone_id, date, created_at, raw_data 
    FROM zone_programs 
    WHERE name ILIKE '%offer 7%' OR name ILIKE '%offer7%'
  `;
  console.log('zone_programs table:', JSON.stringify(zpOffer7, null, 2));

  await sql.end();
}

run().catch(console.error);
