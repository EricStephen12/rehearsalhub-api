import { Router } from 'express';
import { eq, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { subgroups, subgroupSongs, subgroupPraiseNights } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();
const idSchema = z.string().min(1).max(200);

function shapeSubgroup(row: typeof subgroups.$inferSelect) {
  const merged = mergeRawRow(row);
  const memberIds = Array.isArray(merged.memberIds)
    ? merged.memberIds
    : Array.isArray(merged.member_ids)
      ? merged.member_ids
      : [];
  return {
    ...merged,
    id: row.id,
    name: row.name ?? (merged.name as string | undefined),
    zoneId: row.zoneId ?? (merged.zoneId as string | undefined) ?? (merged.zone_id as string | undefined),
    coordinatorId:
      (merged.coordinatorId as string | undefined) ||
      (merged.coordinator_id as string | undefined),
    memberIds,
    status: (merged.status as string | undefined) || 'active',
    description: row.description ?? (merged.description as string | undefined),
  };
}

/** GET /subgroups/mine — subgroups where caller is in memberIds (raw_data). */
router.get('/mine', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db
      .select()
      .from(subgroups)
      .where(
        sql`(${subgroups.rawData}::jsonb -> 'memberIds') ? ${userId}
            OR (${subgroups.rawData}::jsonb -> 'member_ids') ? ${userId}`,
      );
    res.json({ success: true, data: rows.map(shapeSubgroup) });
  } catch (err) {
    console.error('[subgroups/mine]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /subgroups/member-rehearsals */
router.get('/member-rehearsals', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const sgs = await db
      .select({ id: subgroups.id })
      .from(subgroups)
      .where(
        sql`(${subgroups.rawData}::jsonb -> 'memberIds') ? ${userId}
            OR (${subgroups.rawData}::jsonb -> 'member_ids') ? ${userId}`
      );
    if (sgs.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
    const sgIds = sgs.map(sg => sg.id);
    const rows = await db
      .select()
      .from(subgroupPraiseNights)
      .where(inArray(subgroupPraiseNights.subGroupId, sgIds));
    res.json({ success: true, data: rows.map(mergeRawRow) });
  } catch (err) {
    console.error('[subgroups/member-rehearsals]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /subgroups/coordinated */
router.get('/coordinated', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db
      .select()
      .from(subgroups)
      .where(
        sql`${subgroups.rawData}->>'coordinatorId' = ${userId}
            OR ${subgroups.rawData}->>'coordinator_id' = ${userId}`,
      );
    const data = rows.map(shapeSubgroup).filter((sg) => sg.status === 'active' || !sg.status);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[subgroups/coordinated]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:id/songs', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const rows = await db
      .select()
      .from(subgroupSongs)
      .where(
        sql`${subgroupSongs.rawData}->>'subGroupId' = ${parsed.data}
            OR ${subgroupSongs.rawData}->>'sub_group_id' = ${parsed.data}`,
      );
    res.json({
      success: true,
      data: rows.map((row) => mergeRawRow(row)),
    });
  } catch (err) {
    console.error('[subgroups/:id/songs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:id/praise-nights', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const rows = await db
      .select()
      .from(subgroupPraiseNights)
      .where(eq(subgroupPraiseNights.subGroupId, parsed.data));
    res.json({
      success: true,
      data: rows.map((row) => mergeRawRow(row)),
    });
  } catch (err) {
    console.error('[subgroups/:id/praise-nights]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    let query = db.select().from(subgroups);
    const rows = zoneId && typeof zoneId === 'string'
      ? await db.select().from(subgroups).where(
          sql`${subgroups.zoneId} = ${zoneId} OR ${subgroups.rawData}->>'zoneId' = ${zoneId} OR ${subgroups.rawData}->>'zone_id' = ${zoneId}`
        )
      : await query;

    res.json({ success: true, data: rows.map(shapeSubgroup) });
  } catch (err) {
    console.error('[subgroups/ GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subgroups' });
  }
});

router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Subgroup not found' });
      return;
    }

    const raw = (row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? row.rawData
      : {}) as Record<string, any>;
    raw.status = 'active';

    await db.update(subgroups).set({
      rawData: raw,
    }).where(eq(subgroups.id, id));

    res.json({ success: true, message: 'Subgroup approved successfully' });
  } catch (err: any) {
    console.error('[subgroups/:id/approve]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve subgroup' });
  }
});

router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Subgroup not found' });
      return;
    }

    const raw = (row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? row.rawData
      : {}) as Record<string, any>;
    raw.status = 'rejected';
    raw.rejectReason = reason || 'Request rejected by admin';

    await db.update(subgroups).set({
      rawData: raw,
    }).where(eq(subgroups.id, id));

    res.json({ success: true, message: 'Subgroup rejected' });
  } catch (err: any) {
    console.error('[subgroups/:id/reject]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to reject subgroup' });
  }
});

export default router;
