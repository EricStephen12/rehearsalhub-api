import { Router } from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { zoneMembers, hqMembers, profiles, adminRequests, notifications } from '../schema';
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

  // Synthesize legacy zones from profile if they exist (for Firebase-migrated users).
  // IMPORTANT: Only trust invitation-code style fields (zone_code, zoneCode).
  // Do NOT use raw.zone or raw.zoneId — these are stale snapshot fields from old
  // Firebase exports and may point to zones the user has already left.
  if (profileRow[0]) {
    const p = profileRow[0];
    const raw = (p.rawData as any) || {};
    const possibleZoneCodes = new Set<string>(
      [raw.zoneCode, raw.zone_code]
        .filter(Boolean)
        .map(String)
    );
    
    possibleZoneCodes.forEach(zid => {
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

// POST /members/zone-leave — leave a zone
router.post('/zone-leave', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const { zone_id, is_hq } = req.body;

    if (!zone_id) {
      res.status(400).json({ success: false, error: 'Missing zone_id' });
      return;
    }

    if (is_hq) {
      await db.delete(hqMembers).where(
        sql`${hqMembers.userId} = ${userId} AND ${hqMembers.hqGroupId} = ${zone_id}`
      );
    } else {
      await db.delete(zoneMembers).where(
        sql`${zoneMembers.userId} = ${userId} AND ${zoneMembers.zoneId} = ${zone_id}`
      );
    }

    res.json({ success: true, message: 'Successfully left zone' });
  } catch (err) {
    console.error('[members/zone-leave]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /members/request-admin & POST /members/request-hq — User submits access request
const handleAccessRequest = async (req: any, res: any) => {
  try {
    const userId = res.locals.auth.userId as string;
    const { zoneId, zoneCode, reason, userEmail, userName, requestedRole = 'zone_admin' } = req.body;

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveRole = req.path.includes('hq') ? 'hq_member' : (requestedRole || 'zone_admin');

    await db.insert(adminRequests).values({
      id: requestId,
      userId,
      userEmail: userEmail || null,
      userName: userName || null,
      zoneId: zoneId || null,
      zoneCode: zoneCode || null,
      requestedRole: effectiveRole,
      status: 'pending',
      reason: reason || (effectiveRole === 'hq_member' ? 'Request to join HQ Group' : 'Request for Zonal Coordinator access'),
      createdAt: new Date(),
      updatedAt: new Date(),
      rawData: req.body,
    });

    // Notify HQ Admins in-app
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(notifications).values({
      id: notifId,
      title: effectiveRole === 'hq_member' ? 'HQ Group Join Request' : 'New Coordinator Access Request',
      message: `${userName || userEmail || 'A user'} submitted a request for ${effectiveRole === 'hq_member' ? 'HQ Group Access' : 'Zonal Coordinator Access'}.`,
      type: 'admin_request',
      targetAudience: 'hq_admin',
      createdAt: new Date().toISOString(),
      rawData: {
        requestId,
        userId,
        requestedRole: effectiveRole,
        link: '/admin?section=Members',
      },
    }).catch(err => console.error('[members/request] notif error:', err));

    res.json({ success: true, message: 'Request submitted for HQ review', data: { id: requestId } });
  } catch (err: any) {
    console.error('[members/request-admin]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to submit request' });
  }
};

router.post('/request-admin', requireAuth, handleAccessRequest);
router.post('/request-hq', requireAuth, handleAccessRequest);

// GET /members/admin-requests — List admin requests for HQ
router.get('/admin-requests', requireAuth, async (_req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const rows = await db.select().from(adminRequests);
    const data = rows.sort((a, b) => {
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bc - ac;
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[members/admin-requests]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch requests' });
  }
});

// POST /members/admin-requests/:id/approve — Approve request
router.post('/admin-requests/:id/approve', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [reqRow] = await db.select().from(adminRequests).where(eq(adminRequests.id, req.params.id)).limit(1);
    if (!reqRow) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    const roleToGrant = reqRow.requestedRole || 'zone_admin';

    if (roleToGrant === 'hq_member') {
      // Add to hqMembers table and update profile
      const [existingHq] = await db.select().from(hqMembers).where(sql`${hqMembers.userId} = ${reqRow.userId}`);
      if (!existingHq) {
        await db.insert(hqMembers).values({
          id: `hqm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          hqGroupId: 'hq_singers',
          userId: reqRow.userId,
          userEmail: reqRow.userEmail,
          userName: reqRow.userName,
          role: 'member',
          status: 'active',
          createdAt: new Date(),
          joinedAt: new Date(),
          rawData: {},
        });
      }
      await db.update(profiles).set({ hasHqAccess: true }).where(eq(profiles.id, reqRow.userId));
    } else {
      // Update user profile role to zone_admin
      await db.update(profiles).set({ role: 'zone_admin' }).where(eq(profiles.id, reqRow.userId));
    }

    // Update request status
    await db.update(adminRequests).set({
      status: 'approved',
      reviewedBy: auth.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(adminRequests.id, req.params.id));

    // Send confirmation notification to the user
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(notifications).values({
      id: notifId,
      title: 'Request Approved 🎉',
      message: roleToGrant === 'hq_member'
        ? 'Your request to join HQ Group has been approved! You now have access to HQ rehearsals and songs.'
        : 'Your request for Coordinator access has been approved!',
      type: 'request_approved',
      targetUserId: reqRow.userId,
      createdAt: new Date().toISOString(),
      rawData: { requestId: req.params.id, status: 'approved' },
    }).catch(err => console.error('[members/approve] notif error:', err));

    res.json({ success: true, message: `Request approved successfully (${roleToGrant})` });
  } catch (err: any) {
    console.error('[members/admin-requests/:id/approve]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve request' });
  }
});

// POST /members/admin-requests/:id/reject — Reject request
router.post('/admin-requests/:id/reject', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [reqRow] = await db.select().from(adminRequests).where(eq(adminRequests.id, req.params.id)).limit(1);
    if (!reqRow) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    await db.update(adminRequests).set({
      status: 'rejected',
      reviewedBy: auth.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(adminRequests.id, req.params.id));

    // Send rejection notification to user
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(notifications).values({
      id: notifId,
      title: 'Request Status Update',
      message: 'Your access request was not approved by HQ admin at this time.',
      type: 'request_rejected',
      targetUserId: reqRow.userId,
      createdAt: new Date().toISOString(),
      rawData: { requestId: req.params.id, status: 'rejected' },
    }).catch(err => console.error('[members/reject] notif error:', err));

    res.json({ success: true, message: 'Request rejected' });
  } catch (err: any) {
    console.error('[members/admin-requests/:id/reject]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to reject request' });
  }
});

// PATCH /members/:userId — HQ Admin or member updates profile details & credentials
router.patch('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    const isOwner = auth.userId === userId;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';

    if (!isOwner && !isHqAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Member not found' });
      return;
    }

    const body = req.body || {};
    const raw = (existing.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData)
      ? existing.rawData
      : {}) as Record<string, any>;

    const firstName = body.first_name || body.firstName;
    const lastName = body.last_name || body.lastName;
    const phone = body.phone_number || body.phoneNumber;
    const zoneCode = body.zone_code || body.zoneCode || body.zone_id || body.zoneId;
    const kingschatId = body.kingschat_id || body.kingschatId;
    const avatar = body.profile_image_url || body.avatar_url || body.avatar;
    const hasHq = body.has_hq_access !== undefined ? body.has_hq_access : body.hasHqAccess;
    const hiddenFeatures = body.hidden_features !== undefined ? body.hidden_features : body.hiddenFeatures;

    if (firstName !== undefined) raw.first_name = firstName;
    if (lastName !== undefined) raw.last_name = lastName;
    if (phone !== undefined) raw.phone_number = phone;
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

    // Handle password update
    if (body.password) {
      const { hashPassword } = await import('../auth/password');
      const { authCredentials } = await import('../schema');
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

    res.json({ success: true, message: 'Member updated successfully', data: updated });
  } catch (err: any) {
    console.error('[members/:userId PATCH]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update member' });
  }
});

export default router;
