require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 2, ssl: 'require', prepare: false });

async function run() {
  try {
    const tables = ['profiles', 'users', 'chat_users', 'auth_credentials', 'zones', 'songs', 'programs'];
    for (const t of tables) {
      try {
        const c = await sql`SELECT count(*) FROM ${sql(t)}`;
        console.log(t, 'count:', c[0].count);
        if (parseInt(c[0].count) > 0) {
          const sample = await sql`SELECT * FROM ${sql(t)} LIMIT 2`;
          console.log(`Sample from ${t}:`, sample);
        }
      } catch (e) {
        console.log(t, 'error:', e.message);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}
run();
