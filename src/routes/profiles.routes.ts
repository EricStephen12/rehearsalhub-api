import crypto from 'crypto';
import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { profiles, authCredentials, notifications } from '../schema';
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
  const avatar = row.avatarUrl ?? (typeof raw.avatar === 'string' ? raw.avatar : (typeof raw.profile_image_url === 'string' ? raw.profile_image_url : null));
  const phone = typeof raw.phone === 'string' ? raw.phone : (typeof raw.phone_number === 'string' ? raw.phone_number : (typeof raw.phoneNumber === 'string' ? raw.phoneNumber : null));
  const zoneCode = typeof raw.zone_code === 'string' ? raw.zone_code : (typeof raw.zoneCode === 'string' ? raw.zoneCode : null);

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    first_name: row.firstName,
    last_name: row.lastName,
    middle_name: typeof raw.middle_name === 'string' ? raw.middle_name : (typeof raw.middleName === 'string' ? raw.middleName : null),
    email: row.email,
    username: typeof raw.username === 'string' ? raw.username : null,
    alias: typeof raw.alias === 'string' ? raw.alias : null,
    phone,
    phoneNumber: phone,
    phone_number: phone,
    avatar,
    avatarUrl: avatar,
    profile_image_url: avatar,
    designation: typeof raw.designation === 'string' ? raw.designation : null,
    administration: typeof raw.administration === 'string' ? raw.administration : null,
    zoneCode,
    zone_code: zoneCode,
    church: typeof raw.church === 'string' ? raw.church : null,
    region: typeof raw.region === 'string' ? raw.region : null,
    gender: typeof raw.gender === 'string' ? raw.gender : null,
    birthday: typeof raw.birthday === 'string' ? raw.birthday : null,
    role: row.role,
    hasHqAccess: row.hasHqAccess,
    has_hq_access: row.hasHqAccess,
    canAnnotate: !!raw.canAnnotate,
    hiddenFeatures: raw.hidden_features || raw.hiddenFeatures || {},
    hidden_features: raw.hidden_features || raw.hiddenFeatures || {},
    rawData: raw,
    raw_data: raw,
    createdAt: row.createdAt,
    created_at: row.createdAt,
    updatedAt: row.updatedAt,
    updated_at: row.updatedAt,
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

// GET /profiles/directory
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

  // If specific IDs are requested
  if (idList.length > 0) {
    const rows = await db.select().from(profiles).where(inArray(profiles.id, idList));
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || !!auth.hasHqAccess;
  const requestedZoneCode = typeof req.query.zone_code === 'string' ? req.query.zone_code.trim() : null;

  if (isHqAdmin) {
    if (requestedZoneCode && requestedZoneCode !== 'all') {
      const rows = await db.select().from(profiles).where(
        sql`(${profiles.rawData}->>'zone_code' = ${requestedZoneCode} OR ${profiles.rawData}->>'zoneCode' = ${requestedZoneCode})`
      );
      res.json({ success: true, data: rows.map(directoryDto) });
      return;
    }
    const rows = await db.select().from(profiles);
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  // Scoped to zone
  const callerZoneId = (requestedZoneCode && requestedZoneCode !== 'all') ? requestedZoneCode : (auth.zoneId as string | null);
  if (callerZoneId) {
    const rows = await db.select().from(profiles).where(
      sql`(${profiles.rawData}->>'zone_code' = ${callerZoneId} OR ${profiles.rawData}->>'zoneCode' = ${callerZoneId})`
    );
    res.json({ success: true, data: rows.map(directoryDto) });
    return;
  }

  // Fallback return all
  const rows = await db.select().from(profiles);
  res.json({ success: true, data: rows.map(directoryDto) });
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

  const body = parsed.data as Record<string, any>;
  const raw = asRaw(existing.rawData) as Record<string, any>;

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
  if (body.status !== undefined) raw.status = body.status;
  if (body.is_banned !== undefined) raw.is_banned = Boolean(body.is_banned);
  if (body.is_suspended !== undefined) raw.is_suspended = Boolean(body.is_suspended);
  if (body.is_active !== undefined) raw.is_active = Boolean(body.is_active);
  if (body.zone_code !== undefined) {
    raw.zone_code = body.zone_code;
    raw.zoneId = body.zone_code;
  }
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

// POST /profiles/:userId/approve — HQ admin approves a pending join request
router.post('/:userId/approve', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Only HQ admins can approve join requests' });
      return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) { res.status(404).json({ success: false, error: 'Profile not found' }); return; }

    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, pending_hq_approval: false, is_active: true, approved_by: auth.userId, approved_at: new Date().toISOString() };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    // Notify user their account is approved
    const notifId = crypto.randomUUID();
    await db.insert(notifications).values({
      id: notifId,
      type: 'join_request_approved',
      title: '🎉 Your HQ account has been approved',
      message: 'Your request to join the HQ group has been approved by an admin. You can now log in to the Rehearsal Hub Portal.',
      category: 'join_request',
      priority: 'high',
      targetUserId: userId,
      senderId: auth.userId,
      createdAt: new Date().toISOString(),
      rawData: { type: 'join_request_approved', approvedBy: auth.userId, approvedAt: new Date().toISOString(), status: 'approved', zoneCode: raw.zone_code },
    }).catch(() => {});

    res.json({ success: true, message: 'Account approved successfully' });
  } catch (err: any) {
    console.error('[profiles/:userId/approve]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve account' });
  }
});

// POST /profiles/:userId/reject — HQ admin rejects a pending join request
router.post('/:userId/reject', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Only HQ admins can reject join requests' });
      return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) { res.status(404).json({ success: false, error: 'Profile not found' }); return; }

    const { reason } = req.body;
    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, pending_hq_approval: false, is_active: false, rejected: true, rejected_by: auth.userId, rejected_at: new Date().toISOString(), rejection_reason: reason || null };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    const notifId = require('crypto').randomUUID();
    await db.insert(notifications).values({
      id: notifId,
      type: 'join_request_rejected',
      title: 'HQ Join Request — Not Approved',
      message: reason
        ? `Your HQ join request was not approved. Reason: ${reason}`
        : 'Your request to join the HQ group was not approved at this time. Please contact your zone admin.',
      category: 'join_request',
      priority: 'normal',
      targetUserId: userId,
      senderId: auth.userId,
      createdAt: new Date().toISOString(),
      rawData: { type: 'join_request_rejected', rejectedBy: auth.userId, rejectedAt: new Date().toISOString(), reason: reason || null, status: 'rejected' },
    }).catch(() => {});

    res.json({ success: true, message: 'Join request rejected' });
  } catch (err: any) {
    console.error('[profiles/:userId/reject]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to reject request' });
  }
});

// POST /profiles/:userId/suspend
router.post('/:userId/suspend', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' }); return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found' });

    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, status: 'suspended', is_suspended: true, is_active: false, suspended_by: auth.userId, suspended_at: new Date().toISOString() };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    res.json({ success: true, message: 'Member account suspended' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to suspend member' });
  }
});

// POST /profiles/:userId/ban
router.post('/:userId/ban', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' }); return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found' });

    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, status: 'banned', is_banned: true, is_active: false, banned_by: auth.userId, banned_at: new Date().toISOString() };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    res.json({ success: true, message: 'Member banned from platform' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to ban member' });
  }
});

// POST /profiles/:userId/reactivate
router.post('/:userId/reactivate', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' }); return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found' });

    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, status: 'active', is_banned: false, is_suspended: false, is_active: true, reactivated_by: auth.userId, reactivated_at: new Date().toISOString() };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    res.json({ success: true, message: 'Member account reactivated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to reactivate member' });
  }
});

// POST /profiles/:userId/remove-from-zone
router.post('/:userId/remove-from-zone', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const isZoneAdmin = auth.role === 'zone_admin';
    if (!isHqAdmin && !isZoneAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' }); return;
    }
    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found' });

    const raw = asRaw(existing.rawData);
    const updatedRaw = { ...raw, zone_code: null, zoneId: null, zoneName: 'Unassigned', removed_from_zone_at: new Date().toISOString() };
    await db.update(profiles).set({ rawData: updatedRaw, updatedAt: new Date().toISOString() }).where(eq(profiles.id, userId));

    res.json({ success: true, message: 'Member removed from zone' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to remove member from zone' });
  }
});

export default router;
