require('dotenv').config();
const postgres = require('postgres');

async function exploreDB() {
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: 'require',
    prepare: false
  });

  try {
    console.log('--- DATABASE EXPLORATION ---');
    
    // Get all public tables
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    console.log(`Found ${tables.length} tables in public schema.\n`);

    for (const { table_name } of tables) {
      console.log(`\n=== TABLE: ${table_name} ===`);
      
      // Get row count
      const countRes = await sql`SELECT count(*) FROM ${sql(table_name)}`;
      console.log(`Total rows: ${countRes[0].count}`);

      // Get sample data
      const sample = await sql`SELECT * FROM ${sql(table_name)} LIMIT 1`;
      
      if (sample.length > 0) {
        console.log('Sample Row (1):');
        const row = sample[0];
        
        // Truncate long JSON fields or text for readability
        const cleanRow = {};
        for (const [key, value] of Object.entries(row)) {
          if (value === null) {
             cleanRow[key] = null;
          } else if (typeof value === 'object') {
             const str = JSON.stringify(value);
             cleanRow[key] = str.length > 100 ? str.substring(0, 100) + '... (truncated)' : value;
          } else if (typeof value === 'string' && value.length > 100) {
             cleanRow[key] = value.substring(0, 100) + '... (truncated)';
          } else {
             cleanRow[key] = value;
          }
        }
        console.log(JSON.stringify(cleanRow, null, 2));
      } else {
        console.log('Table is empty.');
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}

exploreDB();
