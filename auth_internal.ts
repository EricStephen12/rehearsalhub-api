import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required; refusing to run auth migration with the runtime connection');

const sql = postgres(connectionString, { ssl: 'require', max: 1, prepare: false });
const runtimeRole = process.env.AUTH_RUNTIME_ROLE || 'rehearsalhub_app';
if (!/^[a-z_][a-z0-9_]*$/i.test(runtimeRole)) throw new Error('AUTH_RUNTIME_ROLE must be a simple PostgreSQL role name');

async function main() {
  console.log('Creating narrowly scoped auth_internal functions...');

  await sql.unsafe(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_internal_owner') THEN
        CREATE ROLE auth_internal_owner NOLOGIN;
      END IF;
    END
    $do$;
  `);
  await sql`GRANT auth_internal_owner TO CURRENT_USER`;
  await sql`ALTER ROLE auth_internal_owner NOLOGIN NOBYPASSRLS`;
  await sql`CREATE SCHEMA IF NOT EXISTS auth_internal AUTHORIZATION auth_internal_owner`;
  await sql`REVOKE ALL ON SCHEMA auth_internal FROM PUBLIC`;
  await sql`GRANT USAGE ON SCHEMA auth_internal TO ${sql.unsafe(runtimeRole)}`;
  await sql.unsafe(`
    GRANT SELECT ON public.profiles, public.auth_credentials TO auth_internal_owner;
    GRANT INSERT ON public.profiles, public.auth_credentials, public.notifications TO auth_internal_owner;
    GRANT UPDATE (kingschat_id, raw_data) ON public.profiles TO auth_internal_owner;
    GRANT UPDATE (password_hash, updated_at) ON public.auth_credentials TO auth_internal_owner;
    GRANT SELECT, DELETE ON public.refresh_tokens TO auth_internal_owner;
  `);

  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth_internal.login_candidates(p_identifier text)
    RETURNS TABLE (id text, email text, first_name text, last_name text, role text, has_hq_access boolean, avatar_url text, kingschat_id text, profile_completed boolean, created_at timestamp, raw_data jsonb, updated_at text, password_hash text)
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
    AS $fn$
      SELECT p.id, p.email, p.first_name, p.last_name, p.role, p.has_hq_access, p.avatar_url, p.kingschat_id, p.profile_completed, p.created_at, p.raw_data, p.updated_at, c.password_hash
      FROM public.profiles p JOIN public.auth_credentials c ON c.profile_id = p.id
      CROSS JOIN (SELECT lower(trim(regexp_replace(p_identifier, '^@', ''))) AS value) input
      WHERE lower(p.email) = input.value OR lower(p.raw_data->>'username') = input.value OR lower(p.raw_data->>'alias') = input.value OR lower(p.kingschat_id) = input.value OR lower(p.raw_data->>'kingschat_id') = input.value OR lower(p.raw_data->>'kingschatId') = input.value OR lower(p.raw_data->>'kingsChatId') = input.value OR lower(split_part(p.email, '@', 1)) = input.value OR lower(replace(concat(coalesce(p.first_name, ''), coalesce(p.last_name, '')), ' ', '')) = replace(input.value, ' ', '') OR lower(coalesce(p.first_name, '')) = input.value OR lower(coalesce(p.last_name, '')) = input.value
      ORDER BY CASE WHEN lower(p.email) = input.value THEN 1 WHEN lower(p.raw_data->>'username') = input.value THEN 2 WHEN lower(p.raw_data->>'alias') = input.value THEN 3 WHEN lower(p.kingschat_id) = input.value OR lower(p.raw_data->>'kingschat_id') = input.value THEN 4 WHEN lower(split_part(p.email, '@', 1)) = input.value THEN 5 WHEN lower(replace(concat(coalesce(p.first_name, ''), coalesce(p.last_name, '')), ' ', '')) = replace(input.value, ' ', '') THEN 6 ELSE 7 END
      LIMIT 10
    $fn$;

    CREATE OR REPLACE FUNCTION auth_internal.register_user(p_id text, p_email text, p_password_hash text, p_first_name text, p_last_name text, p_zone_code text, p_designation text, p_kingschat_id text, p_pending_hq boolean)
    RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
    AS $fn$
    DECLARE result public.profiles;
    BEGIN
      IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = lower(trim(p_email))) THEN
        RAISE EXCEPTION 'email already registered' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.profiles (id, email, first_name, last_name, role, has_hq_access, kingschat_id, profile_completed, created_at, updated_at, raw_data)
      VALUES (p_id, lower(trim(p_email)), trim(p_first_name), trim(p_last_name), 'user', false, nullif(trim(p_kingschat_id), ''), true, now(), now()::text, jsonb_build_object('id', p_id, 'email', lower(trim(p_email)), 'first_name', trim(p_first_name), 'last_name', trim(p_last_name), 'zone_code', upper(trim(p_zone_code)), 'designation', nullif(trim(p_designation), ''), 'kingschat_id', nullif(trim(p_kingschat_id), ''), 'role', 'user', 'profile_completed', true, 'pending_hq_approval', p_pending_hq, 'is_active', NOT p_pending_hq, 'hq_request_at', CASE WHEN p_pending_hq THEN now()::text ELSE NULL END))
      RETURNING * INTO result;
      INSERT INTO public.auth_credentials (profile_id, password_hash, created_at, updated_at) VALUES (p_id, p_password_hash, now(), now());
      IF p_pending_hq THEN
        BEGIN
          INSERT INTO public.notifications (id, type, title, message, category, priority, target_audience, sender_id, created_at, raw_data)
          VALUES (gen_random_uuid()::text, 'join_request', 'New HQ Join Request', format('%s (%s) has requested to join an HQ group using zone code %s. Please review and approve or reject their account.', trim(p_first_name) || ' ' || trim(p_last_name), lower(trim(p_email)), upper(trim(p_zone_code))), 'join_request', 'high', 'hq_admin', p_id, now()::text, jsonb_build_object('type', 'join_request', 'applicantId', p_id, 'applicantName', trim(p_first_name) || ' ' || trim(p_last_name), 'applicantEmail', lower(trim(p_email)), 'zoneCode', upper(trim(p_zone_code)), 'designation', nullif(trim(p_designation), ''), 'requestedAt', now()::text, 'status', 'pending'));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
      RETURN result;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION auth_internal.reset_password(p_email text, p_password_hash text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
    AS $fn$
    DECLARE profile_id text;
    BEGIN
      SELECT id INTO profile_id FROM public.profiles WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
      IF profile_id IS NULL THEN RETURN NULL; END IF;
      INSERT INTO public.auth_credentials (profile_id, password_hash, created_at, updated_at) VALUES (profile_id, p_password_hash, now(), now()) ON CONFLICT (profile_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = now();
      DELETE FROM public.refresh_tokens WHERE user_id = profile_id;
      RETURN profile_id;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION auth_internal.kingschat_profiles(p_kingschat_id text, p_email text, p_username text, p_selected_email text)
    RETURNS SETOF public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
    AS $fn$
        DECLARE chosen_id text;
          matching_count integer;
    BEGIN
      IF p_selected_email IS NOT NULL THEN
        SELECT p.id INTO chosen_id FROM public.profiles p WHERE lower(p.email) = lower(trim(p_selected_email)) AND ((p_kingschat_id IS NOT NULL AND (p.kingschat_id = p_kingschat_id OR p.raw_data->>'kingschat_id' = p_kingschat_id OR p.raw_data->>'kingschatId' = p_kingschat_id OR p.raw_data->>'kingsChatId' = p_kingschat_id)) OR (p_email IS NOT NULL AND (lower(p.email) = lower(p_email) OR lower(p.raw_data->>'email') = lower(p_email))) OR (p_username IS NOT NULL AND lower(p.raw_data->>'username') = lower(p_username))) LIMIT 1;
      ELSE
        SELECT count(*) INTO matching_count FROM public.profiles p WHERE (p_kingschat_id IS NOT NULL AND (p.kingschat_id = p_kingschat_id OR p.raw_data->>'kingschat_id' = p_kingschat_id OR p.raw_data->>'kingschatId' = p_kingschat_id OR p.raw_data->>'kingsChatId' = p_kingschat_id)) OR (p_email IS NOT NULL AND (lower(p.email) = lower(p_email) OR lower(p.raw_data->>'email') = lower(p_email))) OR (p_username IS NOT NULL AND lower(p.raw_data->>'username') = lower(p_username));
        IF matching_count = 1 THEN
          SELECT p.id INTO chosen_id FROM public.profiles p WHERE (p_kingschat_id IS NOT NULL AND (p.kingschat_id = p_kingschat_id OR p.raw_data->>'kingschat_id' = p_kingschat_id OR p.raw_data->>'kingsChatId' = p_kingschat_id)) OR (p_email IS NOT NULL AND (lower(p.email) = lower(p_email) OR lower(p.raw_data->>'email') = lower(p_email))) OR (p_username IS NOT NULL AND lower(p.raw_data->>'username') = lower(p_username)) LIMIT 1;
        END IF;
      END IF;
      IF chosen_id IS NOT NULL AND p_kingschat_id IS NOT NULL THEN
        UPDATE public.profiles SET kingschat_id = p_kingschat_id, raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('kingschatId', p_kingschat_id, 'kingschat_id', p_kingschat_id, 'kingsChatId', p_kingschat_id) WHERE id = chosen_id AND (kingschat_id IS NULL OR kingschat_id = p_kingschat_id);
      END IF;
      RETURN QUERY SELECT p.* FROM public.profiles p WHERE (p_selected_email IS NULL OR lower(p.email) = lower(trim(p_selected_email))) AND ((p_kingschat_id IS NOT NULL AND (p.kingschat_id = p_kingschat_id OR p.raw_data->>'kingschat_id' = p_kingschat_id OR p.raw_data->>'kingsChatId' = p_kingschat_id)) OR (p_email IS NOT NULL AND (lower(p.email) = lower(p_email) OR lower(p.raw_data->>'email') = lower(p_email))) OR (p_username IS NOT NULL AND lower(p.raw_data->>'username') = lower(p_username)));
    END
    $fn$;
  `);

  await sql.unsafe(`
    ALTER FUNCTION auth_internal.login_candidates(text) OWNER TO auth_internal_owner;
    ALTER FUNCTION auth_internal.register_user(text,text,text,text,text,text,text,text,boolean) OWNER TO auth_internal_owner;
    ALTER FUNCTION auth_internal.reset_password(text,text) OWNER TO auth_internal_owner;
    ALTER FUNCTION auth_internal.kingschat_profiles(text,text,text,text) OWNER TO auth_internal_owner;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth_internal FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION auth_internal.login_candidates(text) TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION auth_internal.register_user(text,text,text,text,text,text,text,text,boolean) TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION auth_internal.reset_password(text,text) TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION auth_internal.kingschat_profiles(text,text,text,text) TO ${runtimeRole};
  `);
  console.log('Auth functions created and runtime grants applied.');
  await sql.end();
}

main().catch(async (error) => {
  console.error('Auth internal migration failed:', error instanceof Error ? error.message : error);
  await sql.end();
  process.exitCode = 1;
});