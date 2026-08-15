import { Router } from 'express';
import { eq, inArray } from 'drizzle-orm';
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
  const [zoneRows, hqRows] = await Promise.all([
    db.select().from(zoneMembers).where(eq(zoneMembers.userId, userId)),
    db.select().from(hqMembers).where(eq(hqMembers.userId, userId)),
  ]);
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

export default router;
