const postgres = require('postgres');

const adminUrl = 'postgresql://postgres.iibsizcsglzokdhsfyei:Music123%23%2446hub@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
const adminSql = postgres(adminUrl, { ssl: 'require', max: 1, prepare: false });

const appUrl = 'postgresql://rehearsalhub_app.iibsizcsglzokdhsfyei:Music_rehearsalhub_oasis_com@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
const appSql = postgres(appUrl, { ssl: 'require', max: 1, prepare: false });

async function run() {
  try {
    console.log('1. Checking app connection before disabling RLS on profiles:');
    const beforeCount = await appSql`SELECT count(*) FROM public.profiles`;
    console.log('App saw profiles count BEFORE:', beforeCount[0].count);

    console.log('2. Admin disabling RLS on profiles and hq_members:');
    await adminSql`ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;`;
    await adminSql`ALTER TABLE public.hq_members DISABLE ROW LEVEL SECURITY;`;

    console.log('3. Checking app connection AFTER disabling RLS:');
    const afterCount = await appSql`SELECT count(*) FROM public.profiles`;
    console.log('App saw profiles count AFTER:', afterCount[0].count);

    console.log('4. Testing auth_internal.kingschat_profiles function via app role:');
    // Test with Eric Stephen's KingsChat ID
    const testKcId = '687402000ba1d09e3e91b29c';
    const kcMatch = await appSql`
      SELECT id, email, first_name, last_name, kingschat_id
      FROM auth_internal.kingschat_profiles(${testKcId}, null, null, null)
    `;
    console.log('kingschat_profiles result:', kcMatch);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await adminSql.end();
    await appSql.end();
  }
}

run();
