import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { profiles, authCredentials } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { hashPassword } from '../auth/password';
import { broadcast } from '../ws/wsServer';

const router = Router();

type ProfileRow = typeof profiles.$inferSelect;

function asRaw(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function directoryDto(row: ProfileRow) {
  const raw = asRaw(row.rawData);
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    avatar: row.avatarUrl ?? (typeof raw.avatar === 'string' ? raw.avatar : null),
    designation: typeof raw.designation === 'string' ? raw.designation : null,
    zoneCode:
      typeof raw.zone_code === 'string'
        ? raw.zone_code
        : typeof raw.zoneCode === 'string'
          ? raw.zoneCode
          : null,
    church: typeof raw.church === 'string' ? raw.church : null,
    region: typeof raw.region === 'string' ? raw.region : null,
    role: row.role,
  };
}

const updateProfileSchema = z.object({
  first_name: z.string().optional(),
  firstName: z.string().optional(),
  last_name: z.string().optional(),
  lastName: z.string().optional(),
  middle_name: z.string().optional(),
  middleName: z.string().optional(),
  email: z.string().optional(),
  username: z.string().optional(),
  alias: z.string().optional(),
  password: z.string().min(1).optional(),
  role: z.string().optional(),
  has_hq_access: z.boolean().optional(),
  hasHqAccess: z.boolean().optional(),
  phone_number: z.string().optional(),
  phoneNumber: z.string().optional(),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  region: z.string().optional(),
  zone_code: z.string().optional(),
  zoneCode: z.string().optional(),
  zone_id: z.string().optional(),
  zoneId: z.string().optional(),
  church: z.string().optional(),
  kingschat_id: z.string().optional(),
  kingschatId: z.string().optional(),
  designation: z.string().optional(),
  profile_image_url: z.string().optional(),
  avatar_url: z.string().optional(),
  avatar: z.string().optional(),
  expo_push_token: z.string().optional(),
  onesignal_sub_id: z.string().optional(),
  current_device_id: z.string().optional(),
  hidden_features: z.union([z.array(z.string()), z.record(z.boolean())]).optional(),
  hiddenFeatures: z.union([z.array(z.string()), z.record(z.boolean())]).optional(),
});

const directoryIdsQuerySchema = z
  .string()
  .optional()
  .transform((value) => {
    if (!value || value.trim().length === 0) {
      return [] as string[];
    }
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  });

// GET /profiles?kingschat_id=xxx  or  GET /profiles?email=xxx  or  GET /profiles?ids=a,b,c
router.get('/', requireAuth, async (req, res) => {
  const { kingschat_id, email, ids } = req.query;

  if (typeof kingschat_id === 'string') {
    const rows = await db.select().from(profiles).where(eq(profiles.kingschatId, kingschat_id));
    res.json({ success: true, data: rows });
    return;
  }

  if (typeof email === 'string') {
    const rows = await db
      .select()
      .from(profiles)
      .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`);
    res.json({ success: true, data: rows });
    return;
  }

  if (typeof ids === 'string' && ids.length > 0) {
    const idList = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (idList.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
    const rows = await db.select().from(profiles).where(inArray(profiles.id, idList));
    res.json({ success: true, data: rows });
    return;
  }

  res.status(400).json({ success: false, error: 'Provide kingschat_id, email, or ids query param' });
});

// GET /profiles/directory — lightweight contact list for chat pickers
// Optional ?ids=id1,id2,id3 (comma-separated, max 50)
// HQ admins see all profiles. Zone admins/members see profiles in their zone only.
router.get('/directory', requireAuth, async (req, res) => {
  const parsedIds = directoryIdsQuerySchema.safeParse(
    typeof req.query.ids === 'string' ? req.query.ids : undefined,
  );
  if (!parsedIds.success) {
    res.status(400).json({ success: false, error: 'Invalid ids query param' });
    return;
  }

  const auth = res.locals.auth;
  const idList = parsedIds.data;

  // If specific IDs are requested, just return those (used by chat participant lookups)
  if (idList.length > 0) {
    const rows = await db.select().from(profiles).where(inArray(profiles.id, idList));
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  // HQ admins can see the full directory
  const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
  if (isHqAdmin) {
    const rows = await db.select().from(profiles);
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  // Zone members and zone admins: scope to their zone via zone_code in rawData
  // This gives members a contact list of people in their zone for chats
  const callerZoneId = auth.zoneId as string | null;
  if (callerZoneId) {
    const rows = await db.select().from(profiles).where(
      sql`(${profiles.rawData}->>'zone_code' = ${callerZoneId} OR ${profiles.rawData}->>'zoneCode' = ${callerZoneId})`
    );
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  // No zone on the token — return just themselves so they can still function
  const [self] = await db.select().from(profiles).where(eq(profiles.id, auth.userId)).limit(1);
  res.json({ success: true, data: self ? [directoryDto(self)] : [] });
});

// GET /profiles/:userId
router.get('/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!profile) {
    res.status(404).json({ success: false, error: 'Profile not found' });
    return;
  }
  res.json({ success: true, data: profile });
});

// PATCH /profiles/:userId
router.patch('/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const auth = res.locals.auth;

  const isOwner = auth.userId === userId;
  const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';

  if (!isOwner && !isHqAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Profile not found' });
    return;
  }

  const body = parsed.data;
  const raw = asRaw(existing.rawData);

  const firstName = body.first_name || body.firstName;
  const lastName = body.last_name || body.lastName;
  const middleName = body.middle_name || body.middleName;
  const phone = body.phone_number || body.phoneNumber;
  const zoneCode = body.zone_code || body.zoneCode || body.zone_id || body.zoneId;
  const kingschatId = body.kingschat_id || body.kingschatId;
  const avatar = body.profile_image_url || body.avatar_url || body.avatar;
  const hasHq = body.has_hq_access !== undefined ? body.has_hq_access : body.hasHqAccess;
  const hiddenFeatures = body.hidden_features !== undefined ? body.hidden_features : body.hiddenFeatures;

  if (firstName !== undefined) raw.first_name = firstName;
  if (lastName !== undefined) raw.last_name = lastName;
  if (middleName !== undefined) raw.middle_name = middleName;
  if (phone !== undefined) raw.phone_number = phone;
  if (body.gender !== undefined) raw.gender = body.gender;
  if (body.birthday !== undefined) raw.birthday = body.birthday;
  if (body.region !== undefined) raw.region = body.region;
  if (zoneCode !== undefined) {
    raw.zone_code = zoneCode;
    raw.zoneCode = zoneCode;
    raw.zoneId = zoneCode;
  }
  if (body.church !== undefined) raw.church = body.church;
  if (kingschatId !== undefined) raw.kingschat_id = kingschatId;
  if (body.designation !== undefined) raw.designation = body.designation;
  if (avatar !== undefined) {
    raw.profile_image_url = avatar;
    raw.avatar = avatar;
  }
  if (body.username !== undefined) raw.username = body.username.trim().toLowerCase();
  if (body.alias !== undefined) raw.alias = body.alias.trim().toLowerCase();
  if (hiddenFeatures !== undefined) {
    raw.hidden_features = hiddenFeatures;
    raw.hiddenFeatures = hiddenFeatures;
  }
  if (isHqAdmin && body.role !== undefined) {
    raw.role = body.role;
  }
  if (isHqAdmin && hasHq !== undefined) {
    raw.hasHqAccess = hasHq;
    raw.has_hq_access = hasHq;
  }

  // If password is provided, hash and update in auth_credentials
  if (body.password) {
    const hashedPassword = await hashPassword(body.password);
    const [existingCred] = await db.select().from(authCredentials).where(eq(authCredentials.profileId, userId)).limit(1);
    if (existingCred) {
      await db.update(authCredentials)
        .set({ passwordHash: hashedPassword, updatedAt: new Date() })
        .where(eq(authCredentials.profileId, userId));
    } else {
      await db.insert(authCredentials).values({
        profileId: userId,
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  const updateFields: Record<string, any> = {
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(kingschatId !== undefined ? { kingschatId } : {}),
    ...(avatar !== undefined ? { avatarUrl: avatar } : {}),
    ...(body.email !== undefined ? { email: body.email.trim().toLowerCase() } : {}),
    rawData: raw,
    updatedAt: new Date().toISOString(),
  };

  if (isHqAdmin && body.role !== undefined) {
    updateFields.role = body.role;
  }
  if (isHqAdmin && hasHq !== undefined) {
    updateFields.hasHqAccess = hasHq;
  }

  const [updated] = await db
    .update(profiles)
    .set(updateFields)
    .where(eq(profiles.id, userId))
    .returning();

  broadcast('profile', userId, updated);
  res.json({ success: true, message: 'Profile updated', data: updated });
});

// POST /profiles/:userId/password — Direct password update for user or HQ admin
router.post('/:userId/password', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    const isOwner = auth.userId === userId;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';

    if (!isOwner && !isHqAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const { newPassword, password } = req.body || {};
    const targetPassword = newPassword || password;

    if (!targetPassword || typeof targetPassword !== 'string' || targetPassword.length < 1) {
      res.status(400).json({ success: false, error: 'Password is required' });
      return;
    }

    const hashedPassword = await hashPassword(targetPassword);
    const [existingCred] = await db.select().from(authCredentials).where(eq(authCredentials.profileId, userId)).limit(1);

    if (existingCred) {
      await db.update(authCredentials)
        .set({ passwordHash: hashedPassword, updatedAt: new Date() })
        .where(eq(authCredentials.profileId, userId));
    } else {
      await db.insert(authCredentials).values({
        profileId: userId,
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    console.error('[profiles/:userId/password]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update password' });
  }
});

// PATCH /profiles/:userId/role — HQ Admin updates user role
router.patch('/:userId/role', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    if (!isHqAdmin) {
      res.status(403).json({ success: false, error: 'Only HQ Admins can update roles' });
      return;
    }

    const { userId } = req.params;
    const { role } = req.body; // 'member', 'zone_admin', 'hq_admin'

    if (!role || !['member', 'zone_admin', 'hq_admin'].includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role specified' });
      return;
    }

    const hasHqAccess = role === 'hq_admin';
    await db
      .update(profiles)
      .set({
        role,
        hasHqAccess,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(profiles.id, userId));

    res.json({ success: true, message: `Role updated to ${role}` });
  } catch (err: any) {
    console.error('[profiles/:userId/role]', err);
    res.status(500).json({ success: false, error: err?.message || 'Unable to update role' });
  }
});

export default router;
