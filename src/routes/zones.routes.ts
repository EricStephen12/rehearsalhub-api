import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { zones, zoneMembers } from '../schema';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

// GET /zones
router.get('/', requireAuth, async (_req, res) => {
  const rows = await db.select().from(zones);
  res.json({ success: true, data: rows });
});

// GET /zones/:zoneId
router.get('/:zoneId', requireAuth, async (req, res) => {
  const [zone] = await db.select().from(zones).where(eq(zones.id, req.params.zoneId)).limit(1);
  if (!zone) {
    res.status(404).json({ success: false, error: 'Zone not found' });
    return;
  }
  res.json({ success: true, data: zone });
});

// GET /zones/:zoneId/members
router.get('/:zoneId/members', requireAuth, async (req, res) => {
  const members = await db.select().from(zoneMembers).where(eq(zoneMembers.zoneId, req.params.zoneId));
  res.json({ success: true, data: members });
});

export default router;
