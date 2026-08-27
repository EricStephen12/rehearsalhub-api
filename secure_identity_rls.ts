import 'dotenv/config';
import { rawPgClient } from './src/db';

async function secureIdentityRls() {
  console.log('Securing profiles and hq_members with fail-closed RLS policies...');
  console.log('Precondition: the API must set app.current_user_id after JWT authentication.');
  console.log('Precondition: pre-login profile lookups must use a controlled auth-bootstrap database context.');

  const [role] = await rawPgClient`
    SELECT current_user AS role,
           COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
           COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypasses_rls;
  `;
  if (role.is_superuser || role.bypasses_rls) {
    throw new Error(`Refusing identity RLS migration for role ${role.role}: role bypasses RLS.`);
  }

  await rawPgClient`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`;
  await rawPgClient`ALTER TABLE profiles FORCE ROW LEVEL SECURITY;`;
  await rawPgClient`DROP POLICY IF EXISTS tenant_isolation ON profiles;`;
  await rawPgClient`
    CREATE POLICY tenant_isolation ON profiles
    FOR ALL
    USING (
      current_setting('app.is_hq', true) = 'true'
      OR id = current_setting('app.current_user_id', true)
      OR lower(replace(raw_data->>'zoneId', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zone_id', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zoneCode', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zone_code', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
    )
    WITH CHECK (
      current_setting('app.is_hq', true) = 'true'
      OR id = current_setting('app.current_user_id', true)
      OR lower(replace(raw_data->>'zoneId', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zone_id', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zoneCode', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
      OR lower(replace(raw_data->>'zone_code', '-', '')) = lower(replace(current_setting('app.current_zone_id', true), '-', ''))
    );
  `;

  await rawPgClient`ALTER TABLE hq_members ENABLE ROW LEVEL SECURITY;`;
  await rawPgClient`ALTER TABLE hq_members FORCE ROW LEVEL SECURITY;`;
  await rawPgClient`DROP POLICY IF EXISTS tenant_isolation ON hq_members;`;
  await rawPgClient`
    CREATE POLICY tenant_isolation ON hq_members
    FOR ALL
    USING (
      current_setting('app.is_hq', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    )
    WITH CHECK (
      current_setting('app.is_hq', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
  `;

  console.log('Identity RLS policies created successfully.');
}

secureIdentityRls()
  .catch((error) => {
    console.error('Identity RLS migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
