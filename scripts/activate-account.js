require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function run() {
  const email = 'eracissebeauty@gmail.com';
  const users = await sql`SELECT id, first_name, last_name, email, role, has_hq_access, raw_data FROM profiles WHERE lower(email) = ${email.toLowerCase()}`;
  console.log('Found profile:', users);

  if (users.length > 0) {
    const u = users[0];
    const raw = u.raw_data || {};
    raw.pending_hq_approval = false;
    raw.status = 'active';
    raw.is_active = true;

    await sql`UPDATE profiles SET raw_data = ${JSON.stringify(raw)} WHERE id = ${u.id}`;
    console.log('Successfully activated account for:', email);
  } else {
    console.log('No user found with email:', email);
  }

  await sql.end();
}

run().catch(console.error);
