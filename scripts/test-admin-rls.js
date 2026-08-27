const postgres = require('postgres');

// Clean admin url
const adminUrl = 'postgresql://postgres.iibsizcsglzokdhsfyei:Music123%23%2446hub@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
const sql = postgres(adminUrl, { ssl: 'require', max: 1, prepare: false });

async function run() {
  try {
    const profCount = await sql`SELECT count(*) FROM public.profiles`;
    console.log('Admin saw profiles count:', profCount[0].count);

    const kcProfiles = await sql`
      SELECT id, email, first_name, last_name, kingschat_id, raw_data->>'kingschat_id' as kc1, raw_data->>'kingschatId' as kc2
      FROM public.profiles 
      WHERE kingschat_id IS NOT NULL OR raw_data->>'kingschat_id' IS NOT NULL OR raw_data->>'kingschatId' IS NOT NULL
      LIMIT 10
    `;
    console.log('Kingschat profiles sample from admin:');
    console.log(kcProfiles);

    const rls = await sql`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS force_rls
      FROM pg_class c
      WHERE c.relname = 'profiles';
    `;
    console.log('Profiles RLS:', rls);

    const policies = await sql`
      SELECT schemaname, tablename, policyname, roles, cmd, qual
      FROM pg_policies
      WHERE tablename = 'profiles';
    `;
    console.log('Policies on profiles:', policies);

  } catch (err) {
    console.error('Admin test error:', err);
  } finally {
    await sql.end();
  }
}

run();
