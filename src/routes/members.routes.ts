import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { zoneMembers, hqMembers, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

/** Membership DTOs only — never collapse membership id into a profile id. */
type MembershipRow = {
  id: string;
  userId: string;
  role: string | null;
  status: string | null;
  userEmail?: string | null;
  userName?: string | null;
  zoneId?: string | null;
  hqGroupId?: string | null;
};

async function enrichMemberships<T extends MembershipRow>(
  rows: T[],
): Promise<Array<T & { profile: Record<string, unknown> | null }>> {
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  if (ids.length === 0) {
    return rows.map((r) => ({ ...r, profile: null }));
  }
  const profileRows = await db.select().from(profiles).where(inArray(profiles.id, ids));
  const byId = new Map(profileRows.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.userId);
    return {
      ...r,
      profile: p
        ? {
            id: p.id,
            email: p.email,
            firstName: p.firstName,
            lastName: p.lastName,
            avatarUrl: p.avatarUrl,
            role: p.role,
          }
        : null,
    };
  });
}

function wantsEnrich(enrich: unknown): boolean {
  return enrich === '1' || enrich === 'true';
}

// GET /members/mine — current user's zone + HQ memberships (membership DTOs)
router.get('/mine', requireAuth, async (req, res) => {
  const userId = res.locals.auth.userId as string;
  const [zoneRows, hqRows, profileRow] = await Promise.all([
    db.select().from(zoneMembers).where(eq(zoneMembers.userId, userId)),
    db.select().from(hqMembers).where(eq(hqMembers.userId, userId)),
    db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
  ]);

  // Synthesize legacy zones from profile if they exist (for Firebase-migrated users)
  if (profileRow[0]) {
    const p = profileRow[0];
    const raw = (p.rawData as any) || {};
    const possibleZones = new Set<string>(
      [raw.zoneId, raw.zone_id, raw.zoneCode, raw.zone_code, raw.zone]
        .filter(Boolean)
        .map(String)
    );
    
    possibleZones.forEach(zid => {
      if (!zoneRows.some(z => z.zoneId === zid)) {
        zoneRows.push({
          id: `legacy_${zid}`,
          zoneId: zid,
          userId: userId,
          role: p.role || 'member',
          status: 'active',
          createdAt: p.createdAt,
          rawData: null,
        } as any);
      }
    });
  }

  res.json({ success: true, data: { zoneMembers: zoneRows, hqMembers: hqRows } });
});

// GET /members/by-user/:userId — self or admin/hq_admin
router.get('/by-user/:userId', requireAuth, async (req, res) => {
  const auth = res.locals.auth;
  const { userId } = req.params;
  const isSelf = auth.userId === userId;
  const isAdmin = auth.role === 'admin' || auth.role === 'hq_admin';

  if (!isSelf && !isAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const [zoneRows, hqRows] = await Promise.all([
    db.select().from(zoneMembers).where(eq(zoneMembers.userId, userId)),
    db.select().from(hqMembers).where(eq(hqMembers.userId, userId)),
  ]);
  res.json({ success: true, data: { zoneMembers: zoneRows, hqMembers: hqRows } });
});

// GET /members/hq — membership rows; optional ?enrich=1 joins profiles as sibling `profile`
router.get('/hq', requireAuth, async (req, res) => {
  const auth = res.locals.auth;
  if (auth.role !== 'admin' && auth.role !== 'hq_admin') {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  const members = await db.select().from(hqMembers);
  const data = wantsEnrich(req.query.enrich) ? await enrichMemberships(members) : members;
  res.json({ success: true, data });
});

// GET /members/hq/:hqGroupId — membership DTOs (any authenticated user)
router.get('/hq/:hqGroupId', requireAuth, async (req, res) => {
  const members = await db
    .select()
    .from(hqMembers)
    .where(eq(hqMembers.hqGroupId, req.params.hqGroupId));
  const data = wantsEnrich(req.query.enrich) ? await enrichMemberships(members) : members;
  res.json({ success: true, data });
});

// GET /members/zone/:zoneId — membership DTOs
router.get('/zone/:zoneId', requireAuth, async (req, res) => {
  const members = await db.select().from(zoneMembers).where(eq(zoneMembers.zoneId, req.params.zoneId));
  const data = wantsEnrich(req.query.enrich) ? await enrichMemberships(members) : members;
  res.json({ success: true, data });
});

// POST /members/zone-join — join a new zone
router.post('/zone-join', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const { zone_id, is_hq, user_email, user_name } = req.body;

    if (!zone_id) {
      res.status(400).json({ success: false, error: 'Missing zone_id' });
      return;
    }

    if (is_hq) {
      const existing = await db
        .select()
        .from(hqMembers)
        .where(
          sql`${hqMembers.userId} = ${userId} AND ${hqMembers.hqGroupId} = ${zone_id}`
        );
      if (existing.length === 0) {
        await db.insert(hqMembers).values({
          id: Math.random().toString(36).slice(2, 10),
          hqGroupId: zone_id,
          userId,
          userEmail: user_email || null,
          userName: user_name || null,
          role: 'member',
          status: 'active',
          createdAt: new Date(),
          joinedAt: new Date(),
          rawData: {},
        });
      }
    } else {
      const existing = await db
        .select()
        .from(zoneMembers)
        .where(
          sql`${zoneMembers.userId} = ${userId} AND ${zoneMembers.zoneId} = ${zone_id}`
        );
      if (existing.length === 0) {
        await db.insert(zoneMembers).values({
          id: Math.random().toString(36).slice(2, 10),
          zoneId: zone_id,
          userId,
          role: 'member',
          status: 'active',
          createdAt: new Date(),
          rawData: {},
        });
      }
    }

    res.json({ success: true, message: 'Successfully joined' });
  } catch (err) {
    console.error('[members/zone-join]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
