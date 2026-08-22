import { Router } from 'express';
import { eq, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { subgroups, subgroupSongs, subgroupPraiseNights, notifications, profiles } from '../schema';
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

router.get('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = (req.query.zoneId && req.query.zoneId !== 'all') ? String(req.query.zoneId) : (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[] = [];
    if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      rows = await db.select().from(subgroups).where(
        sql`lower(replace(${subgroups.zoneId}, '-', '')) = ${withoutHyphen} OR 
            lower(${subgroups.zoneId}) = ${withHyphen} OR 
            lower(replace(${subgroups.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
            lower(replace(${subgroups.rawData}->>'zone_id', '-', '')) = ${withoutHyphen}`
      );
    } else {
      rows = await db.select().from(subgroups);
    }

    res.json({ success: true, data: rows.map(shapeSubgroup) });
  } catch (err) {
    console.error('[subgroups/ GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subgroups' });
  }
});

/** POST /subgroups & POST /subgroups/requests — Create a new Church/Subgroup or request approval */
const handleCreateSubgroup = async (req: any, res: any) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId as string;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const isZoneAdmin = auth.role === 'zone_admin';

    const {
      name,
      type = 'church',
      description = '',
      coordinatorName = '',
      coordinatorEmail = '',
      coordinatorId = userId,
      zoneId = auth.zoneId || 'global',
      estimatedMembers = 10,
      memberIds = [userId],
      status: requestedStatus
    } = req.body || {};

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: 'Church / Group name is required' });
      return;
    }

    // Admins can create active units directly, regular members start as pending
    const finalStatus = (isHqAdmin || isZoneAdmin) ? (requestedStatus || 'active') : 'pending';
    const subgroupId = `sg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const rawData = {
      id: subgroupId,
      name: name.trim(),
      type,
      description: description.trim(),
      coordinatorName: coordinatorName.trim() || auth.email || 'Coordinator',
      coordinatorEmail: coordinatorEmail.trim() || auth.email || '',
      coordinatorId: coordinatorId || userId,
      zoneId: zoneId || 'global',
      estimatedMembers: Number(estimatedMembers) || 10,
      memberIds: Array.isArray(memberIds) && memberIds.length > 0 ? memberIds : [userId],
      status: finalStatus,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };

    await db.insert(subgroups).values({
      id: subgroupId,
      name: name.trim(),
      zoneId: zoneId || 'global',
      description: description.trim(),
      rawData,
    });

    // 1. Notify Admins if request is pending review
    if (finalStatus === 'pending') {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.insert(notifications).values({
        id: notifId,
        title: 'New Church Approval Request',
        message: `${rawData.coordinatorName} requested to register "${name.trim()}" in ${zoneId}.`,
        type: 'church_request',
        targetAudience: 'hq_admin',
        zoneId: zoneId || 'global',
        createdAt: new Date().toISOString(),
        rawData: {
          subgroupId,
          requesterId: userId,
          type: 'church_request',
          link: '/admin?section=Churches',
        },
      }).catch(err => console.error('[subgroups] Admin notif error:', err));

      // 2. Notify the User that their request was received
      const userNotifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.insert(notifications).values({
        id: userNotifId,
        title: 'Church Request Submitted',
        message: `Your request to register "${name.trim()}" has been received and is pending admin approval.`,
        type: 'church_request',
        targetUserId: userId,
        createdAt: new Date().toISOString(),
        rawData: {
          subgroupId,
          status: 'pending',
        },
      }).catch(err => console.error('[subgroups] User notif error:', err));
    }

    res.json({
      success: true,
      message: finalStatus === 'active' ? 'Church created successfully' : 'Church request submitted for review',
      data: shapeSubgroup({
        id: subgroupId,
        name: name.trim(),
        zoneId: zoneId || 'global',
        description: description.trim(),
        rawData,
      } as any),
    });
  } catch (err: any) {
    console.error('[subgroups/ POST]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to create church' });
  }
};

router.post('/', requireAuth, handleCreateSubgroup);
router.post('/requests', requireAuth, handleCreateSubgroup);

router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Church not found' });
      return;
    }

    const raw = (row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? row.rawData
      : {}) as Record<string, any>;
    raw.status = 'active';

    await db.update(subgroups).set({
      rawData: raw,
    }).where(eq(subgroups.id, id));

    // Send confirmation notification to the requester / coordinator
    const targetUser = raw.coordinatorId || raw.createdBy;
    if (targetUser) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.insert(notifications).values({
        id: notifId,
        title: 'Church Approved 🎉',
        message: `Your church "${row.name || raw.name}" has been approved by admin!`,
        type: 'church_approved',
        targetUserId: targetUser,
        createdAt: new Date().toISOString(),
        rawData: { subgroupId: id, status: 'active' },
      }).catch(err => console.error('[subgroups/approve] notif error:', err));
    }

    res.json({ success: true, message: 'Church approved successfully' });
  } catch (err: any) {
    console.error('[subgroups/:id/approve]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve church' });
  }
});

router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Church not found' });
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

    // Send rejection notification to the requester / coordinator
    const targetUser = raw.coordinatorId || raw.createdBy;
    if (targetUser) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.insert(notifications).values({
        id: notifId,
        title: 'Church Request Update',
        message: `Your request for "${row.name || raw.name}" was not approved: ${reason || 'Declined by admin'}`,
        type: 'church_rejected',
        targetUserId: targetUser,
        createdAt: new Date().toISOString(),
        rawData: { subgroupId: id, status: 'rejected', reason },
      }).catch(err => console.error('[subgroups/reject] notif error:', err));
    }

    res.json({ success: true, message: 'Church request rejected' });
  } catch (err: any) {
    console.error('[subgroups/:id/reject]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to reject church' });
  }
});

export default router;
