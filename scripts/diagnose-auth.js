const postgres = require('postgres');
require('dotenv').config();

async function check() {
  console.log('--- Starting Auth & DB Diagnostic ---');
  const appSql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1, prepare: false });
  const adminSql = postgres(process.env.DATABASE_ADMIN_URL, { ssl: 'require', max: 1, prepare: false });

  try {
    const roles = await adminSql`SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname IN ('rehearsalhub_app', 'auth_internal_owner', 'postgres')`;
    console.log('Roles:', roles);

    const funcs = await adminSql`
      SELECT routine_schema, routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_schema = 'auth_internal';
    `;
    console.log('auth_internal routines:', funcs.map(f => f.routine_name));

    console.log('\n--- Profiles Count ---');
    const profileCount = await appSql`SELECT count(*) FROM public.profiles`;
    console.log('Profiles in DB:', profileCount[0].count);

    console.log('\n--- Auth Credentials Count ---');
    const credCount = await adminSql`SELECT count(*) FROM public.auth_credentials`;
    console.log('Auth credentials in DB:', credCount[0].count);

    console.log('\n--- Recent 10 Profiles & Credentials Check ---');
    const recentProfiles = await appSql`
      SELECT p.id, p.email, p.first_name, p.last_name, p.kingschat_id, p.role, 
             (SELECT count(*) FROM public.auth_credentials c WHERE c.profile_id = p.id) as has_credential,
             p.raw_data
      FROM public.profiles p 
      ORDER BY p.created_at DESC NULLS LAST 
      LIMIT 10
    `;
    console.log(JSON.stringify(recentProfiles, null, 2));

    if (recentProfiles.length > 0) {
      for (const p of recentProfiles.slice(0, 3)) {
        if (p.email) {
          console.log(`\nTesting auth_internal.login_candidates('${p.email}'):`);
          try {
            const cand = await appSql`SELECT id, email, first_name, last_name, (password_hash IS NOT NULL) as has_hash FROM auth_internal.login_candidates(${p.email})`;
            console.log('Result:', cand);
          } catch (e) {
            console.error('Candidate error for', p.email, ':', e.message);
          }
        }
      }
    }

    console.log('\n--- Debugging login_candidates query ---');
    const testEmail = 'takeshopstores@gmail.com';
    
    // 1. Direct query with admin
    const directAdmin = await adminSql`
      SELECT p.id, p.email, c.password_hash
      FROM public.profiles p
      JOIN public.auth_credentials c ON c.profile_id = p.id
      WHERE lower(p.email) = lower(${testEmail})
    `;
    console.log('1. Direct admin query:', directAdmin);

    // 2. Direct query with app role
    try {
      const directApp = await appSql`
        SELECT p.id, p.email, c.password_hash
        FROM public.profiles p
        JOIN public.auth_credentials c ON c.profile_id = p.id
        WHERE lower(p.email) = lower(${testEmail})
      `;
      console.log('2. Direct app query:', directApp);
    } catch (e) {
      console.error('2. Direct app query failed:', e.message);
    }

    // 3. Check exact function definition in DB
    const fnDef = await adminSql`
      SELECT routine_name, routine_definition 
      FROM information_schema.routines 
      WHERE routine_schema = 'auth_internal' AND routine_name = 'login_candidates'
    `;
    console.log('3. Stored fnDef:', fnDef);

    // 4. Check function permissions
    const fnGrants = await adminSql`
      SELECT routine_schema, routine_name, grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'auth_internal';
    `;
    console.log('4. Routine privileges:', fnGrants);

    console.log('\n--- Testing KingsChat profiles function ---');
    const testKcId = '687402000ba1d09e3e91b29c';
    const kcResAdmin = await adminSql`SELECT id, email, first_name, kingschat_id FROM auth_internal.kingschat_profiles(${testKcId}, null, null, null)`;
    console.log('KC Admin result:', kcResAdmin);

    const kcResApp = await appSql`SELECT id, email, first_name, kingschat_id FROM auth_internal.kingschat_profiles(${testKcId}, null, null, null)`;
    console.log('KC App result:', kcResApp);

    console.log('\n--- Testing disabling RLS on auth_credentials & refresh_tokens ---');
    await adminSql`ALTER TABLE public.auth_credentials DISABLE ROW LEVEL SECURITY;`;
    await adminSql`ALTER TABLE public.refresh_tokens DISABLE ROW LEVEL SECURITY;`;

    console.log('Now testing login_candidates again:');
    const candAfter = await appSql`SELECT id, email, first_name, last_name, role, (password_hash IS NOT NULL) as has_hash FROM auth_internal.login_candidates(${testEmail})`;
    console.log('Login candidates after RLS disable on auth_credentials:', candAfter);



    console.log('\n--- Checking RLS status on ALL public tables ---');
    const allTables = await adminSql`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;
    console.log('All public tables RLS:', allTables);

    console.log('\n--- Checking if any passwords exist in raw_data or elsewhere ---');
    const rawDataCheck = await adminSql`
      SELECT count(*) as count_with_pw 
      FROM public.profiles 
      WHERE raw_data->>'password' IS NOT NULL 
         OR raw_data->>'password_hash' IS NOT NULL 
         OR raw_data->>'passwordHash' IS NOT NULL;
    `;
    console.log('Profiles with password in raw_data:', rawDataCheck[0].count_with_pw);

    const kcCount = await adminSql`
      SELECT count(*) as count_kc FROM public.profiles WHERE kingschat_id IS NOT NULL AND kingschat_id != '';
    `;
    console.log('Profiles with kingschat_id in column:', kcCount[0].count_kc);

    const kcRawCount = await adminSql`
      SELECT count(*) as count_kc_raw FROM public.profiles WHERE raw_data->>'kingschat_id' IS NOT NULL OR raw_data->>'kingschatId' IS NOT NULL;
    `;
    console.log('Profiles with kingschat_id in raw_data:', kcRawCount[0].count_kc_raw);

    console.log('\n--- Admin profiles in database ---');
    const adminProfiles = await adminSql`
      SELECT p.id, p.email, p.first_name, p.last_name, p.role, p.has_hq_access, p.kingschat_id,
             (SELECT count(*) FROM public.auth_credentials c WHERE c.profile_id = p.id) as has_cred
      FROM public.profiles p
      WHERE p.role IN ('admin', 'hq_admin', 'super_admin', 'zone_admin')
         OR p.has_hq_access = true
      LIMIT 15;
    `;
    console.log('Admin profiles:', JSON.stringify(adminProfiles, null, 2));

  } catch (err) {
    console.error('Diagnostic error:', err);
  } finally {
    await appSql.end();
    await adminSql.end();
  }
}

check();
