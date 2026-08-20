import crypto from 'crypto';
import { eq, or, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../db';
import { authCredentials, refreshTokens, profiles, zoneMembers, hqMembers } from '../schema';
import { signAccessToken, generateRefreshToken } from './token';
import { verifyPassword, hashPassword, validatePasswordStrength } from './password';
import { revocationStore } from './revocation';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const REFRESH_EXPIRES_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '30', 10);

function refreshExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_EXPIRES_DAYS);
  return d;
}

function asRaw(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Migrated emails are mixed-case — always compare case-insensitively. */
function emailEquals(normalizedLower: string) {
  return sql`lower(${profiles.email}) = ${normalizedLower}`;
}

/** Map profile.role / hasHqAccess → JWT role claim. */
export function tokenRole(profile: {
  role: string | null;
  hasHqAccess: boolean | null;
}): string {
  if (profile.hasHqAccess) return 'hq_admin';
  const r = (profile.role || '').toLowerCase();
  if (r === 'admin' || r === 'hq_admin' || r === 'zone_admin') return r;
  return 'member';
}

function zoneIdFromProfile(profile: { rawData: unknown }): string | null {
  const raw = asRaw(profile.rawData);
  const z =
    raw.zoneId ||
    raw.zone_id ||
    raw.zoneCode ||
    raw.zone_code ||
    null;
  return typeof z === 'string' ? z : null;
}

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  zoneId: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export type AuthTokenResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

async function issueTokens(profile: typeof profiles.$inferSelect): Promise<AuthTokenResult> {
  const email = (profile.email || '').toLowerCase();
  const role = tokenRole(profile);
  const zoneId = zoneIdFromProfile(profile);

  const rawRefresh = generateRefreshToken();
  const tokenHash = await bcrypt.hash(rawRefresh, 12);
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    profileId: profile.id,
    tokenHash,
    expiresAt: refreshExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: profile.id,
    role,
    zoneId: zoneId ?? undefined,
  });

  return {
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: profile.id,
      email,
      role,
      zoneId,
      firstName: profile.firstName,
      lastName: profile.lastName,
    },
  };
}

export async function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  zoneCode: string;
  designation?: string;
  kingschatId?: string;
}): Promise<AuthTokenResult> {
  if (!validatePasswordStrength(input.password)) {
    throw new AuthError('Password must be at least 8 characters', 400);
  }

  const email = input.email.toLowerCase().trim();
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(emailEquals(email))
    .limit(1);
  if (existing) {
    throw new AuthError('Email already registered', 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const [profile] = await db
    .insert(profiles)
    .values({
      id,
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: 'user',
      hasHqAccess: false,
      kingschatId: input.kingschatId?.trim() || null,
      profileCompleted: true,
      createdAt: now,
      updatedAt: now.toISOString(),
      rawData: {
        id,
        email,
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        zone_code: input.zoneCode.trim(),
        designation: input.designation?.trim() || null,
        kingschat_id: input.kingschatId?.trim() || null,
        role: 'user',
        profile_completed: true,
      },
    })
    .returning();

  await db.insert(authCredentials).values({
    profileId: id,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  return issueTokens(profile);
}

export async function login(identifier: string, password: string): Promise<AuthTokenResult> {
  const norm = (identifier || '').toLowerCase().trim();
  if (!norm) {
    throw new AuthError('Identifier and password required');
  }

  // Find profile by email, username, kingschatId, or name/alias
  const [profile] = await db
    .select()
    .from(profiles)
    .where(
      or(
        sql`lower(${profiles.email}) = ${norm}`,
        sql`lower(${profiles.kingschatId}) = ${norm}`,
        sql`lower(${profiles.rawData}->>'username') = ${norm}`,
        sql`lower(${profiles.rawData}->>'alias') = ${norm}`,
        sql`lower(${profiles.rawData}->>'kingschat_id') = ${norm}`,
        sql`lower(${profiles.rawData}->>'kingschatId') = ${norm}`,
        sql`lower(replace(concat(coalesce(${profiles.firstName}, ''), coalesce(${profiles.lastName}, '')), ' ', '')) = ${norm.replace(/\s+/g, '')}`
      )
    )
    .limit(1);

  const [cred] = profile
    ? await db
        .select()
        .from(authCredentials)
        .where(eq(authCredentials.profileId, profile.id))
        .limit(1)
    : [undefined];

  if (!profile || !cred || !(await verifyPassword(password, cred.passwordHash))) {
    throw new AuthError('Invalid credentials');
  }

  return issueTokens(profile);
}

export async function refresh(
  rawToken: string,
  profileId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.profileId, profileId));

  let matchedRow: (typeof rows)[number] | undefined;
  for (const row of rows) {
    if (await bcrypt.compare(rawToken, row.tokenHash)) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) {
    await db.delete(refreshTokens).where(eq(refreshTokens.profileId, profileId));
    throw new AuthError('Invalid or reused refresh token');
  }

  if (matchedRow.expiresAt <= new Date()) {
    await db.delete(refreshTokens).where(eq(refreshTokens.profileId, profileId));
    throw new AuthError('Refresh token expired');
  }

  await db.delete(refreshTokens).where(eq(refreshTokens.id, matchedRow.id));

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) throw new AuthError('User not found');

  const newRaw = generateRefreshToken();
  const newHash = await bcrypt.hash(newRaw, 12);
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    profileId: profile.id,
    tokenHash: newHash,
    expiresAt: refreshExpiresAt(),
  });

  const accessToken = signAccessToken({
    sub: profile.id,
    role: tokenRole(profile),
    zoneId: zoneIdFromProfile(profile) ?? undefined,
  });

  return { accessToken, refreshToken: newRaw };
}

export async function logout(
  jti: string,
  exp: number,
  profileId: string,
  rawRefreshToken: string,
): Promise<void> {
  revocationStore.revoke(jti, new Date(exp * 1000));

  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.profileId, profileId));
  for (const row of rows) {
    if (await bcrypt.compare(rawRefreshToken, row.tokenHash)) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
      break;
    }
  }
}

export type MeResult = AuthUser & {
  memberships: {
    zoneMembers: Array<Record<string, unknown>>;
    hqMembers: Array<Record<string, unknown>>;
  };
};

export async function getMe(profileId: string): Promise<MeResult> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) throw new AuthError('User not found', 404);

  const [zoneRows, hqRows] = await Promise.all([
    db.select().from(zoneMembers).where(eq(zoneMembers.userId, profileId)),
    db.select().from(hqMembers).where(eq(hqMembers.userId, profileId)),
  ]);

  return {
    id: profile.id,
    email: (profile.email || '').toLowerCase(),
    role: tokenRole(profile),
    zoneId: zoneIdFromProfile(profile),
    firstName: profile.firstName,
    lastName: profile.lastName,
    memberships: {
      zoneMembers: zoneRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        zoneId: r.zoneId,
        role: r.role,
        status: r.status,
      })),
      hqMembers: hqRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        hqGroupId: r.hqGroupId,
        role: r.role,
        status: r.status,
        userEmail: r.userEmail,
        userName: r.userName,
      })),
    },
  };
}

/** Upsert password for an existing profile (reset-password). Does not mutate profile fields. */
export async function setPasswordForProfile(
  profileId: string,
  newPassword: string,
): Promise<void> {
  if (!validatePasswordStrength(newPassword)) {
    throw new AuthError('Password must be at least 8 characters', 400);
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(authCredentials)
    .where(eq(authCredentials.profileId, profileId))
    .limit(1);

  if (existing) {
    await db
      .update(authCredentials)
      .set({ passwordHash, updatedAt: now })
      .where(eq(authCredentials.profileId, profileId));
  } else {
    await db.insert(authCredentials).values({
      profileId,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.delete(refreshTokens).where(eq(refreshTokens.profileId, profileId));
}

export async function issueTokensForProfile(
  profile: typeof profiles.$inferSelect,
): Promise<AuthTokenResult> {
  return issueTokens(profile);
}
