import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../db';
import { refreshTokens, profiles, zoneMembers, hqMembers } from '../schema';
import { signAccessToken, generateRefreshToken } from './token';
import { verifyPassword, hashPassword, validatePasswordStrength } from './password';
import { revocationStore } from './revocation';

// HQ zone invitation codes — these require admin approval before login
const HQ_ZONE_CODES = new Set([
  'ZONE001', 'ZONE002', 'ZONE003', 'ZONE004', 'ZONE005',
  'ZONEORCH', 'ZONEPRES', 'ZONEPRES2', 'ZONEDIR', 'ZONEOFTP',
  'ZONEOFTD', 'ZONENAT', 'ZONEINT', 'ZONESA1'
]);

function isHQZoneCode(code: string): boolean {
  return HQ_ZONE_CODES.has(code.toUpperCase().trim());
}

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

/** Map profile.role / hasHqAccess → JWT role claim. */
export function tokenRole(profile: {
  role: string | null;
  hasHqAccess: boolean | null;
}): string {
  if (profile.hasHqAccess) return 'hq_admin';
  const r = (profile.role || '').toLowerCase();
  if (r === 'admin' || r === 'hq_admin' || r === 'super_admin') return 'hq_admin';
  if (r === 'zone_admin' || r === 'zone_coordinator' || r === 'subgroup_admin' || r === 'subgroup_coordinator') return 'zone_admin';
  if (r === 'church_coordinator') return 'church_coordinator';
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

type InternalProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  has_hq_access: boolean | null;
  avatar_url: string | null;
  kingschat_id: string | null;
  profile_completed: boolean | null;
  created_at: Date | null;
  raw_data: unknown;
  updated_at: string | null;
  password_hash?: string | null;
};

function profileFromInternal(row: InternalProfileRow): typeof profiles.$inferSelect {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    hasHqAccess: row.has_hq_access,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    rawData: row.raw_data,
    kingschatId: row.kingschat_id,
    profileCompleted: row.profile_completed,
    updatedAt: row.updated_at,
  };
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
}): Promise<AuthTokenResult | { pendingApproval: true; userId: string; zoneName?: string }> {
  if (!validatePasswordStrength(input.password)) {
    throw new AuthError('Password must be at least 8 characters', 400);
  }

  const email = input.email.toLowerCase().trim();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  const cleanZoneCode = input.zoneCode.trim().toUpperCase();
  const isHQRequest = isHQZoneCode(cleanZoneCode);

  let profile: typeof profiles.$inferSelect;
  try {
    const rows = await db.execute(sql`
      SELECT * FROM auth_internal.register_user(
        ${id}, ${email}, ${passwordHash}, ${input.firstName}, ${input.lastName},
        ${cleanZoneCode}, ${input.designation?.trim() || null},
        ${input.kingschatId?.trim() || null}, ${isHQRequest}
      )
    `) as unknown as InternalProfileRow[];
    profile = profileFromInternal(rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new AuthError('Email already registered', 409);
    }
    throw error;
  }

  // If HQ zone: notify HQ admins and return pending state
  if (isHQRequest) {
    return { pendingApproval: true, userId: id };
  }

  return issueTokens(profile);
}

export async function login(identifier: string, password: string): Promise<AuthTokenResult> {
  const norm = (identifier || '').toLowerCase().trim().replace(/^@/, '');
  if (!norm) {
    throw new AuthError('Identifier and password required');
  }

  // Find candidate profiles ordered by exact match relevance:
  // 1: Exact Email
  // 2: Exact Username
  // 3: Exact Alias
  // 4: Exact KingsChat ID
  // 5: Email prefix (before @)
  // 6: Full Name
  // 7: First/Last Name
  const candidateRows = await db.execute(sql`
    SELECT * FROM auth_internal.login_candidates(${norm})
  `) as unknown as InternalProfileRow[];
  const candidateProfiles = candidateRows.map(profileFromInternal);

  if (!candidateProfiles || candidateProfiles.length === 0) {
    throw new AuthError('Invalid credentials');
  }

  // Check candidate profiles in priority order
  for (const row of candidateRows) {
    const candidate = profileFromInternal(row);
    if (row.password_hash && (await verifyPassword(password, row.password_hash))) {
      // Block login for accounts pending HQ approval
      const raw = asRaw(candidate.rawData);
      if (raw.pending_hq_approval === true) {
        throw new AuthError('PENDING_APPROVAL', 403);
      }

      return issueTokens(candidate);
    }
  }

  throw new AuthError('Invalid credentials');
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

export async function resetPasswordForEmail(email: string, newPassword: string): Promise<void> {
  if (!validatePasswordStrength(newPassword)) {
    throw new AuthError('Password must be at least 8 characters', 400);
  }
  const passwordHash = await hashPassword(newPassword);
  const rows = await db.execute(sql`
    SELECT auth_internal.reset_password(${email.toLowerCase().trim()}, ${passwordHash}) AS profile_id
  `) as unknown as Array<{ profile_id: string | null }>;
  if (!rows[0]?.profile_id) throw new AuthError('User not found', 404);
}

export async function getKingschatProfiles(
  kingschatId: string | null,
  email: string | null,
  username: string | null,
  selectedEmail: string | null,
): Promise<Array<typeof profiles.$inferSelect>> {
  const rows = await db.execute(sql`
    SELECT * FROM auth_internal.kingschat_profiles(${kingschatId}, ${email}, ${username}, ${selectedEmail})
  `) as unknown as InternalProfileRow[];
  return rows.map(profileFromInternal);
}

export async function issueTokensForProfile(
  profile: typeof profiles.$inferSelect,
): Promise<AuthTokenResult> {
  return issueTokens(profile);
}
