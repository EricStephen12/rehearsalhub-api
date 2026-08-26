import { Router } from 'express';
import { eq, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  subgroups, subgroupMembers, subgroupSongs, subgroupPraiseNights,
  notifications, profiles, ministeredSongs,
} from '../schema';
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
      (merged.coordinator_id as string | undefined) ||
      row.coordinatorId,
    coordinatorName:
      (merged.coordinatorName as string | undefined) ||
      (merged.coordinator_name as string | undefined) ||
      row.coordinatorName,
    coordinatorEmail:
      (merged.coordinatorEmail as string | undefined) ||
      (merged.coordinator_email as string | undefined),
    memberIds,
    type: row.type || (merged.type as string | undefined) || 'church',
    status: (merged.status as string | undefined) || row.status || 'active',
    description: row.description ?? (merged.description as string | undefined),
  };
}

/** GET /subgroups/mine */
router.get('/mine', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db
      .select()
      .from(subgroups)
      .where(
        sql`${subgroups.coordinatorId} = ${userId}
            OR ${subgroups.createdBy} = ${userId}
            OR ${subgroups.rawData}->>'coordinatorId' = ${userId}
            OR ${subgroups.rawData}->>'coordinator_id' = ${userId}
            OR ${subgroups.rawData}->>'createdBy' = ${userId}
            OR (${subgroups.rawData}::jsonb -> 'memberIds') ? ${userId}
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
        sql`${subgroups.coordinatorId} = ${userId}
            OR ${subgroups.createdBy} = ${userId}
            OR (${subgroups.rawData}::jsonb -> 'memberIds') ? ${userId}
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
        sql`${subgroups.coordinatorId} = ${userId}
            OR ${subgroups.createdBy} = ${userId}
            OR ${subgroups.rawData}->>'coordinatorId' = ${userId}
            OR ${subgroups.rawData}->>'coordinator_id' = ${userId}
            OR ${subgroups.rawData}->>'createdBy' = ${userId}`,
      );
    const data = rows.map(shapeSubgroup);
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
    const effectiveZoneId = req.tenant?.effectiveZoneId !== undefined
      ? req.tenant.effectiveZoneId
      : ((req.query.zoneId && req.query.zoneId !== 'all') ? String(req.query.zoneId) : (!isHqAdmin ? (auth.zoneId as string | null) : null));

    let rows: any[] = [];
    if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      if (isHqAdmin) {
        rows = await db.select().from(subgroups).where(
          sql`lower(replace(${subgroups.zoneId}, '-', '')) = ${withoutHyphen} OR 
              lower(${subgroups.zoneId}) = ${withHyphen} OR 
              lower(replace(${subgroups.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
              lower(replace(${subgroups.rawData}->>'zone_id', '-', '')) = ${withoutHyphen} OR
              ${subgroups.status} = 'pending' OR
              ${subgroups.rawData}->>'status' = 'pending'`
        );
      } else {
        rows = await db.select().from(subgroups).where(
          sql`lower(replace(${subgroups.zoneId}, '-', '')) = ${withoutHyphen} OR 
              lower(${subgroups.zoneId}) = ${withHyphen} OR 
              lower(replace(${subgroups.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
              lower(replace(${subgroups.rawData}->>'zone_id', '-', '')) = ${withoutHyphen}`
        );
      }
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
      type,
      status: finalStatus,
      coordinatorId: coordinatorId || userId,
      coordinatorName: coordinatorName.trim() || auth.email || 'Coordinator',
      createdBy: userId,
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
        type,
        status: finalStatus,
        coordinatorId: coordinatorId || userId,
        coordinatorName: coordinatorName.trim() || auth.email || 'Coordinator',
        createdBy: userId,
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
      status: 'active',
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
      status: 'rejected',
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

// ── Subgroup CRUD ─────────────────────────────────────────────────────────────

/** PATCH /subgroups/:id — update name, description, or status */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { id } = req.params;
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const raw = (row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? row.rawData : {}) as Record<string, any>;

    const isCoordinator = raw.coordinatorId === auth.userId || raw.coordinator_id === auth.userId || row.coordinatorId === auth.userId;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    if (!isCoordinator && !isAdmin) { res.status(403).json({ success: false, error: 'Forbidden' }); return; }

    const { name, description, status } = req.body || {};
    const updateFields: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) { updateFields.name = name.trim(); raw.name = name.trim(); }
    if (description !== undefined) { updateFields.description = description.trim(); raw.description = description.trim(); }
    if (status !== undefined && isAdmin) { updateFields.status = status; raw.status = status; }
    updateFields.rawData = raw;

    const [updated] = await db.update(subgroups).set(updateFields).where(eq(subgroups.id, id)).returning();
    res.json({ success: true, data: shapeSubgroup(updated as any) });
  } catch (err: any) {
    console.error('[subgroups/:id PATCH]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update' });
  }
});

/** DELETE /subgroups/:id — coordinator or admin only */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { id } = req.params;
    const [row] = await db.select().from(subgroups).where(eq(subgroups.id, id)).limit(1);
    if (!row) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const raw = (row.rawData && typeof row.rawData === 'object' ? row.rawData : {}) as Record<string, any>;
    const isCoordinator = raw.coordinatorId === auth.userId || row.coordinatorId === auth.userId;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    if (!isCoordinator && !isAdmin) { res.status(403).json({ success: false, error: 'Forbidden' }); return; }

    // Remove all member rows first
    await db.delete(subgroupMembers).where(eq(subgroupMembers.subgroupId, id));
    await db.delete(subgroups).where(eq(subgroups.id, id));
    res.json({ success: true, message: 'Subgroup deleted' });
  } catch (err: any) {
    console.error('[subgroups/:id DELETE]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete' });
  }
});

// ── Subgroup Members (dedicated table) ────────────────────────────────────────

/** GET /subgroups/:id/members — list members with profile data */
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid id' }); return; }

    // Prefer new subgroup_members table; fall back to rawData memberIds for legacy subgroups
    const memberRows = await db
      .select()
      .from(subgroupMembers)
      .where(eq(subgroupMembers.subgroupId, parsed.data));

    let userIds: string[] = memberRows.filter(m => m.status === 'active').map(m => m.userId);

    // Backward compat: if no rows in table yet, read from rawData
    if (userIds.length === 0) {
      const [sg] = await db.select().from(subgroups).where(eq(subgroups.id, parsed.data)).limit(1);
      if (sg) {
        const raw = (sg.rawData && typeof sg.rawData === 'object' ? sg.rawData : {}) as Record<string, any>;
        userIds = Array.isArray(raw.memberIds) ? raw.memberIds : Array.isArray(raw.member_ids) ? raw.member_ids : [];
      }
    }

    if (userIds.length === 0) { res.json({ success: true, data: [] }); return; }

    const profileRows = await db.select().from(profiles).where(inArray(profiles.id, userIds));
    const profileMap = new Map(profileRows.map(p => [p.id, p]));

    const data = memberRows.length > 0
      ? memberRows.map(m => ({ ...m, profile: profileMap.get(m.userId) || null }))
      : userIds.map(uid => ({ userId: uid, role: 'member', status: 'active', profile: profileMap.get(uid) || null }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[subgroups/:id/members GET]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** POST /subgroups/members — add a member to a subgroup + send notification */
router.post('/members', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const schema = z.object({
      subGroupId: z.string().min(1),
      userId: z.string().min(1),
      role: z.enum(['member', 'coordinator', 'admin']).default('member'),
      addedBy: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

    const { subGroupId, userId, role, addedBy } = parsed.data;

    // Verify subgroup exists
    const [sg] = await db.select().from(subgroups).where(eq(subgroups.id, subGroupId)).limit(1);
    if (!sg) { res.status(404).json({ success: false, error: 'Subgroup not found' }); return; }

    // Check caller is coordinator or admin
    const raw = (sg.rawData && typeof sg.rawData === 'object' ? sg.rawData : {}) as Record<string, any>;
    const isCoordinator = raw.coordinatorId === auth.userId || raw.coordinator_id === auth.userId || sg.coordinatorId === auth.userId;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    if (!isCoordinator && !isAdmin) { res.status(403).json({ success: false, error: 'Only coordinators can add members' }); return; }

    // Idempotent — don't re-add if already active
    const [existing] = await db
      .select()
      .from(subgroupMembers)
      .where(sql`${subgroupMembers.subgroupId} = ${subGroupId} AND ${subgroupMembers.userId} = ${userId}`)
      .limit(1);

    if (existing && existing.status === 'active') {
      res.json({ success: true, message: 'Already a member', data: existing });
      return;
    }

    const memberId = `sgm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let memberRow;
    if (existing) {
      // Re-activate if previously removed
      [memberRow] = await db
        .update(subgroupMembers)
        .set({ status: 'active', role, addedBy: addedBy || auth.userId, joinedAt: new Date() })
        .where(eq(subgroupMembers.id, existing.id))
        .returning();
    } else {
      [memberRow] = await db
        .insert(subgroupMembers)
        .values({
          id: memberId,
          subgroupId: subGroupId,
          userId,
          role,
          status: 'active',
          addedBy: addedBy || auth.userId,
        })
        .returning();
    }

    // Also keep rawData.memberIds in sync for backward compat
    const memberIds: string[] = Array.isArray(raw.memberIds) ? raw.memberIds
      : Array.isArray(raw.member_ids) ? raw.member_ids : [];
    if (!memberIds.includes(userId)) {
      raw.memberIds = [...memberIds, userId];
      await db.update(subgroups).set({ rawData: raw }).where(eq(subgroups.id, subGroupId));
    }

    // Get coordinator's name for the notification
    const [coordinatorProfile] = await db.select().from(profiles).where(eq(profiles.id, auth.userId)).limit(1);
    const coordinatorName = coordinatorProfile
      ? [coordinatorProfile.firstName, coordinatorProfile.lastName].filter(Boolean).join(' ') || 'Your coordinator'
      : 'Your coordinator';

    // Send in-app notification to the added user
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(notifications).values({
      id: notifId,
      title: 'Added to Subgroup 🎵',
      message: `${coordinatorName} added you to "${sg.name || raw.name || 'a subgroup'}". You now have access to its rehearsal songs and setlists.`,
      type: 'subgroup_added',
      targetUserId: userId,
      createdAt: new Date().toISOString(),
      rawData: { subgroupId: subGroupId, subgroupName: sg.name || raw.name, addedBy: auth.userId },
    }).catch(err => console.error('[subgroups/members] notif error:', err));

    res.status(201).json({ success: true, message: 'Member added successfully', data: memberRow });
  } catch (err: any) {
    console.error('[subgroups/members POST]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to add member' });
  }
});

/** DELETE /subgroups/members?subGroupId=&userId= — remove a member */
router.delete('/members', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { subGroupId, userId } = req.query as { subGroupId?: string; userId?: string };
    if (!subGroupId || !userId) { res.status(400).json({ success: false, error: 'subGroupId and userId are required' }); return; }

    const [sg] = await db.select().from(subgroups).where(eq(subgroups.id, subGroupId)).limit(1);
    if (!sg) { res.status(404).json({ success: false, error: 'Subgroup not found' }); return; }

    const raw = (sg.rawData && typeof sg.rawData === 'object' ? sg.rawData : {}) as Record<string, any>;
    const isCoordinator = raw.coordinatorId === auth.userId || sg.coordinatorId === auth.userId;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    const isSelf = auth.userId === userId; // allow self-removal
    if (!isCoordinator && !isAdmin && !isSelf) { res.status(403).json({ success: false, error: 'Forbidden' }); return; }

    // Soft-delete from subgroup_members
    await db
      .update(subgroupMembers)
      .set({ status: 'removed' })
      .where(sql`${subgroupMembers.subgroupId} = ${subGroupId} AND ${subgroupMembers.userId} = ${userId}`);

    // Keep rawData in sync
    const memberIds: string[] = Array.isArray(raw.memberIds) ? raw.memberIds : [];
    raw.memberIds = memberIds.filter((id: string) => id !== userId);
    await db.update(subgroups).set({ rawData: raw }).where(eq(subgroups.id, subGroupId));

    res.json({ success: true, message: 'Member removed' });
  } catch (err: any) {
    console.error('[subgroups/members DELETE]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to remove member' });
  }
});

// ── Praise Nights / Setlists ──────────────────────────────────────────────────

/** POST /subgroups/praise-nights — create a new rehearsal setlist */
router.post('/praise-nights', requireAuth, async (req, res) => {
  try {
    const { name, date, location, category = 'ongoing', subGroupId } = req.body || {};
    if (!subGroupId || !name?.trim()) {
      res.status(400).json({ success: false, error: 'subGroupId and name are required' });
      return;
    }
    const id = `sgpn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const [row] = await db.insert(subgroupPraiseNights).values({
      id,
      name: name.trim(),
      date: date || '',
      location: location || '',
      category,
      subGroupId,
      songIds: [],
      rawData: { subGroupId, name, date, location, category },
    }).returning();
    res.status(201).json({ success: true, data: mergeRawRow(row) });
  } catch (err: any) {
    console.error('[subgroups/praise-nights POST]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to create setlist' });
  }
});

/** PATCH /subgroups/praise-nights/:id — update a setlist */
router.patch('/praise-nights/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(subgroupPraiseNights).where(eq(subgroupPraiseNights.id, id)).limit(1);
    if (!row) { res.status(404).json({ success: false, error: 'Setlist not found' }); return; }

    const { name, date, location, category, songIds } = req.body || {};
    const prevRaw = (row.rawData && typeof row.rawData === 'object' ? row.rawData : {}) as Record<string, any>;
    const nextRaw = {
      ...prevRaw,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(songIds !== undefined ? { songIds } : {}),
    };

    const [updated] = await db.update(subgroupPraiseNights)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(date !== undefined ? { date } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(songIds !== undefined ? { songIds } : {}),
        updatedAt: new Date(),
        rawData: nextRaw,
      })
      .where(eq(subgroupPraiseNights.id, id))
      .returning();

    res.json({ success: true, data: mergeRawRow(updated as any) });
  } catch (err: any) {
    console.error('[subgroups/praise-nights/:id PATCH]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update setlist' });
  }
});

/** DELETE /subgroups/praise-nights/:id */
router.delete('/praise-nights/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(subgroupPraiseNights).where(eq(subgroupPraiseNights.id, id));
    res.json({ success: true, message: 'Setlist deleted' });
  } catch (err: any) {
    console.error('[subgroups/praise-nights/:id DELETE]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete setlist' });
  }
});

// ── Subgroup Songs ────────────────────────────────────────────────────────────

/** POST /subgroups/songs/import — import song(s) from All Ministered / Master catalog into subgroup */
router.post('/songs/import', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { masterSongIds, masterSongId, subGroupId, zoneId, praiseNightId } = req.body || {};
    const ids: string[] = Array.isArray(masterSongIds)
      ? masterSongIds
      : masterSongId ? [masterSongId] : [];

    if (!subGroupId || ids.length === 0) {
      res.status(400).json({ success: false, error: 'subGroupId and masterSongIds are required' });
      return;
    }

    const masterRows = await db
      .select()
      .from(ministeredSongs)
      .where(inArray(ministeredSongs.id, ids));

    if (masterRows.length === 0) {
      res.status(404).json({ success: false, error: 'Master song(s) not found' });
      return;
    }

    const importedSongs: any[] = [];
    const insertedIds: string[] = [];

    for (const mRow of masterRows) {
      const mData = mergeRawRow(mRow);
      const songId = `sgs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const rawData = {
        ...mData,
        id: songId,
        subGroupId,
        sub_group_id: subGroupId,
        masterSongId: mRow.id,
        importedFromMaster: true,
        status: 'unheard',
        rehearsalStatus: 'unheard',
        history: [],
        comments: '',
        importedAt: new Date().toISOString(),
        importedBy: auth.userId,
      };

      const [row] = await db.insert(subgroupSongs).values({
        id: songId,
        title: String((mData as any).title || 'Untitled Song').trim(),
        key: String((mData as any).key || ''),
        tempo: String((mData as any).tempo || ''),
        zoneId: zoneId || (mData as any).zoneId || '',
        status: 'active',
        rawData,
      }).returning();

      importedSongs.push(mergeRawRow(row));
      insertedIds.push(songId);
    }

    // If praiseNightId provided, add newly inserted song IDs into the setlist
    if (praiseNightId && insertedIds.length > 0) {
      const [pn] = await db.select().from(subgroupPraiseNights).where(eq(subgroupPraiseNights.id, praiseNightId)).limit(1);
      if (pn) {
        const rawPn = (pn.rawData && typeof pn.rawData === 'object' ? pn.rawData : {}) as Record<string, any>;
        const currentSongIds = Array.isArray(pn.songIds) ? pn.songIds : Array.isArray(rawPn.songIds) ? rawPn.songIds : [];
        const nextSongIds = Array.from(new Set([...currentSongIds, ...insertedIds]));
        await db.update(subgroupPraiseNights)
          .set({
            songIds: nextSongIds,
            updatedAt: new Date(),
            rawData: { ...rawPn, songIds: nextSongIds },
          })
          .where(eq(subgroupPraiseNights.id, praiseNightId));
      }
    }

    res.status(201).json({ success: true, count: importedSongs.length, data: importedSongs });
  } catch (err: any) {
    console.error('[subgroups/songs/import POST]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to import songs' });
  }
});

/** POST /subgroups/songs — add a song to a subgroup with full rich metadata */
router.post('/songs', requireAuth, async (req, res) => {
  try {
    const {
      title, key, tempo, writer, leadSinger, lyrics, solfa, notation, solfas,
      audioFile, audioUrls, category, categories, subGroupId, zoneId, comments, history, conductorGuide
    } = req.body || {};
    if (!subGroupId || !title?.trim()) {
      res.status(400).json({ success: false, error: 'subGroupId and title are required' });
      return;
    }
    const id = `sgs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const rawData = {
      subGroupId,
      sub_group_id: subGroupId,
      id,
      title: title.trim(),
      key: key || '',
      tempo: tempo || '',
      writer: writer || '',
      leadSinger: leadSinger || '',
      lyrics: lyrics || '',
      solfa: solfa || notation || solfas || '',
      audioFile: audioFile || '',
      audioUrls: audioUrls || {},
      category: category || 'Praise Night',
      categories: categories || [category || 'Praise Night'],
      comments: comments || '',
      history: Array.isArray(history) ? history : [],
      conductorGuide: conductorGuide || '',
      status: 'unheard',
      rehearsalStatus: 'unheard',
      createdAt: new Date().toISOString(),
    };
    const [row] = await db.insert(subgroupSongs).values({
      id,
      title: title.trim(),
      key: key || '',
      tempo: tempo || '',
      zoneId: zoneId || '',
      status: 'active',
      rawData,
    }).returning();
    res.status(201).json({ success: true, data: mergeRawRow(row) });
  } catch (err: any) {
    console.error('[subgroups/songs POST]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to add song' });
  }
});

/** PATCH /subgroups/songs/:id — update all subgroup song fields including comments, status, history */
router.patch('/songs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(subgroupSongs).where(eq(subgroupSongs.id, id)).limit(1);
    if (!row) { res.status(404).json({ success: false, error: 'Song not found' }); return; }

    const {
      title, key, tempo, writer, leadSinger, lyrics, solfa, notation, solfas,
      audioFile, audioUrls, category, categories, status, rehearsalStatus, isActive,
      comments, history, conductorGuide, customParts
    } = req.body || {};

    const prevRaw = (row.rawData && typeof row.rawData === 'object' ? row.rawData : {}) as Record<string, any>;
    const nextRaw = {
      ...prevRaw,
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(tempo !== undefined ? { tempo } : {}),
      ...(writer !== undefined ? { writer } : {}),
      ...(leadSinger !== undefined ? { leadSinger } : {}),
      ...(lyrics !== undefined ? { lyrics } : {}),
      ...(solfa !== undefined ? { solfa } : {}),
      ...(notation !== undefined ? { solfa: notation } : {}),
      ...(solfas !== undefined ? { solfas } : {}),
      ...(audioFile !== undefined ? { audioFile } : {}),
      ...(audioUrls !== undefined ? { audioUrls } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(categories !== undefined ? { categories } : {}),
      ...(status !== undefined ? { status, rehearsalStatus: status } : {}),
      ...(rehearsalStatus !== undefined ? { status: rehearsalStatus, rehearsalStatus } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(comments !== undefined ? { comments } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(conductorGuide !== undefined ? { conductorGuide } : {}),
      ...(customParts !== undefined ? { customParts } : {}),
      updatedAt: new Date().toISOString(),
    };

    const [updated] = await db.update(subgroupSongs)
      .set({
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(key !== undefined ? { key } : {}),
        ...(tempo !== undefined ? { tempo } : {}),
        ...(status !== undefined ? { status } : {}),
        rawData: nextRaw,
      })
      .where(eq(subgroupSongs.id, id))
      .returning();

    res.json({ success: true, data: mergeRawRow(updated as any) });
  } catch (err: any) {
    console.error('[subgroups/songs/:id PATCH]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update song' });
  }
});

/** DELETE /subgroups/songs/:id — delete a subgroup song */
router.delete('/songs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(subgroupSongs).where(eq(subgroupSongs.id, id));
    res.json({ success: true, message: 'Song deleted' });
  } catch (err: any) {
    console.error('[subgroups/songs/:id DELETE]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete song' });
  }
});

export default router;
