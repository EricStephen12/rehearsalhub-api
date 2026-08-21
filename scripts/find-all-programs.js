require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });

async function run() {
  console.log('=== SEARCHING ALL PROGRAMS IN DATABASE ===');
  const allProgs = await sql`
    SELECT id, name, category, status, zone_id, date, raw_data 
    FROM programs 
    ORDER BY created_at DESC
  `;
  console.log(`Total programs found: ${allProgs.length}`);
  
  allProgs.forEach(p => {
    console.log(`- ID: ${p.id} | Name: "${p.name}" | ZoneId: "${p.zone_id}" | Category: "${p.category}" | Status: "${p.status}" | Date: "${p.date}"`);
  });

  await sql.end();
}

run().catch(console.error);
