/**
 * Live smoke: auth against profiles + auth_credentials (no Firebase).
 * Uses a disposable credential on an existing profile; cleans credential after.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';

async function main(): Promise<void> {
  const {
    login,
    getMe,
    setPasswordForProfile,
    AuthError,
  } = await import('../src/auth/auth.service');
  const { db } = await import('../src/db');
  const { profiles, hqMembers, authCredentials, refreshTokens } = await import('../src/schema');

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const admin = postgres(url, { max: 1 });

  const beforeProfiles = await admin`SELECT COUNT(*)::int AS c FROM profiles`;
  console.log('profiles before:', beforeProfiles[0]?.c);

  const pick = await admin`
    SELECT p.id, p.email, p.first_name, p.raw_data
    FROM profiles p
    INNER JOIN hq_members h ON h.user_id = p.id
    WHERE p.email IS NOT NULL AND p.email <> ''
    LIMIT 1
  `;
  if (pick.length === 0) {
    throw new Error('No profile with hq_members link found for smoke');
  }
  const profile = pick[0];
  const email = String(profile.email).toLowerCase();
  const profileId = String(profile.id);

  console.log('smoke profile id prefix:', profileId.slice(0, 8));
  console.log('smoke email domain:', email.includes('@') ? email.split('@')[1] : '(none)');

  let noCredOk = false;
  try {
    await login(email, 'WrongPassword123!');
  } catch (err) {
    noCredOk = err instanceof AuthError && err.message === 'Invalid credentials';
  }
  console.log('login without credential → Invalid credentials:', noCredOk);

  const smokePassword = 'SmokeTest_Pass_9x!';
  await setPasswordForProfile(profileId, smokePassword);

  const credCount = await admin`
    SELECT COUNT(*)::int AS c FROM auth_credentials WHERE profile_id = ${profileId}
  `;
  console.log('credential rows for profile:', credCount[0]?.c);

  const tokens = await login(email, smokePassword);
  const subMatches = tokens.user.id === profileId;
  console.log('login ok, sub === profile.id:', subMatches, 'role:', tokens.user.role);

  const me = await getMe(profileId);
  console.log(
    'me memberships hq:',
    me.memberships.hqMembers.length,
    'zone:',
    me.memberships.zoneMembers.length,
  );
  console.log('me id === profile:', me.id === profileId);

  const hqGroupId = me.memberships.hqMembers[0]?.hqGroupId as string | undefined;
  if (hqGroupId) {
    const members = await db.select().from(hqMembers).where(eq(hqMembers.hqGroupId, hqGroupId));
    const userIds = members.map((m) => m.userId);
    const linked =
      userIds.length === 0
        ? []
        : await db.select({ id: profiles.id }).from(profiles).where(inArray(profiles.id, userIds));
    console.log('hq members for group:', members.length, 'linked profiles:', linked.length);
  }

  await db.delete(refreshTokens).where(eq(refreshTokens.profileId, profileId));
  await db.delete(authCredentials).where(eq(authCredentials.profileId, profileId));

  const afterProfiles = await admin`SELECT COUNT(*)::int AS c FROM profiles`;
  console.log('profiles after:', afterProfiles[0]?.c);
  console.log('profiles unchanged:', beforeProfiles[0]?.c === afterProfiles[0]?.c);

  await admin.end();

  if (!noCredOk || !subMatches || me.id !== profileId) {
    process.exit(1);
  }
  console.log('SMOKE PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
