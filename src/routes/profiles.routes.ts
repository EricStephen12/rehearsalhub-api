import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
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
  last_name: z.string().optional(),
  middle_name: z.string().optional(),
  phone_number: z.string().optional(),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  region: z.string().optional(),
  zone_code: z.string().optional(),
  church: z.string().optional(),
  kingschat_id: z.string().optional(),
  designation: z.string().optional(),
  profile_image_url: z.string().url().optional(),
  expo_push_token: z.string().optional(),
  onesignal_sub_id: z.string().optional(),
  current_device_id: z.string().optional(),
}).strict();

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
router.get('/directory', requireAuth, async (req, res) => {
  const parsedIds = directoryIdsQuerySchema.safeParse(
    typeof req.query.ids === 'string' ? req.query.ids : undefined,
  );
  if (!parsedIds.success) {
    res.status(400).json({ success: false, error: 'Invalid ids query param' });
    return;
  }

  const idList = parsedIds.data;
  const rows =
    idList.length > 0
      ? await db.select().from(profiles).where(inArray(profiles.id, idList))
      : await db.select().from(profiles);

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
  const isHqAdmin = auth.role === 'hq_admin';

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
  const rawKeys: Array<keyof typeof body> = [
    'middle_name',
    'phone_number',
    'gender',
    'birthday',
    'region',
    'zone_code',
    'church',
    'designation',
    'expo_push_token',
    'onesignal_sub_id',
    'current_device_id',
  ];
  for (const key of rawKeys) {
    if (body[key] !== undefined) {
      raw[key] = body[key];
    }
  }
  if (body.profile_image_url !== undefined) {
    raw.profile_image_url = body.profile_image_url;
    raw.avatar = body.profile_image_url;
  }
  if (body.first_name !== undefined) raw.first_name = body.first_name;
  if (body.last_name !== undefined) raw.last_name = body.last_name;
  if (body.kingschat_id !== undefined) raw.kingschat_id = body.kingschat_id;

  const [updated] = await db
    .update(profiles)
    .set({
      ...(body.first_name !== undefined ? { firstName: body.first_name } : {}),
      ...(body.last_name !== undefined ? { lastName: body.last_name } : {}),
      ...(body.kingschat_id !== undefined ? { kingschatId: body.kingschat_id } : {}),
      ...(body.profile_image_url !== undefined ? { avatarUrl: body.profile_image_url } : {}),
      rawData: raw,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.id, userId))
    .returning();

  broadcast('profile', userId, updated);
  res.json({ success: true, data: updated });
});

export default router;
