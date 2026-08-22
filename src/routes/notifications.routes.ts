import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { notifications, userGroups, userNotifications, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /notifications — per-user read state, audience-scoped, and admin feeds */
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId as string;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin' || req.query.admin === 'true';

    const [notifRows, groupRows, readRows] = await Promise.all([
      db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(150),
      db
        .select()
        .from(userGroups)
        .where(sql`${userGroups.rawData}->>'user_id' = ${userId} OR ${userGroups.rawData}->>'userId' = ${userId}`),
      db
        .select()
        .from(userNotifications)
        .where(
          sql`${userNotifications.rawData}->>'user_id' = ${userId} OR ${userNotifications.rawData}->>'userId' = ${userId} OR ${userNotifications.id} LIKE ${userId + '_%'}`,
        ),
    ]);

    const groupNames = new Set<string>();
    for (const g of groupRows) {
      const m = mergeRawRow(g);
      const name = (m.group_name || m.groupName) as string | undefined;
      if (name) groupNames.add(name);
    }

    const readIds = new Set<string>();
    for (const r of readRows) {
      const m = mergeRawRow(r);
      const nid = (m.notification_id || m.notificationId) as string | undefined;
      if (nid) readIds.add(nid);
      else if (r.id.startsWith(`${userId}_`)) readIds.add(r.id.slice(userId.length + 1));
    }

    const data = notifRows
      .map((row) => {
        const merged = mergeRawRow(row);
        const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, unknown>) : {};

        const audience =
          (row.targetAudience as string | undefined) ||
          (raw.target_audience as string | undefined) ||
          (raw.targetAudience as string | undefined) ||
          'all';
        const targetUser =
          row.targetUserId ||
          (raw.target_user_id as string | undefined) ||
          (raw.targetUserId as string | undefined);
        const targetGroup =
          (raw.target_group as string | undefined) || (raw.targetGroup as string | undefined);

        const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
        const isZoneAdmin = auth.role === 'zone_admin' || isHqAdmin;
        const userZone = auth.zoneId as string | undefined;

        // Strict visibility resolution
        let visible = false;

        // 1. Direct 1-on-1 personal notification
        if (targetUser) {
          if (targetUser === userId) {
            visible = true;
          } else if (req.query.admin === 'true' && isHqAdmin) {
            // HQ Admin inspecting admin dispatch log
            visible = true;
          }
        } else if (audience === 'hq_admin') {
          // 2. HQ Admin exclusive notification (e.g. join requests)
          visible = isHqAdmin;
        } else if (audience === 'zone_admin') {
          // 3. Zonal Admin notification
          visible = isZoneAdmin;
        } else if (audience === 'group' && targetGroup) {
          // 4. Subgroup notification
          visible = groupNames.has(targetGroup) || isHqAdmin;
        } else if (audience === 'all' || audience === 'broadcast') {
          // 5. Broadcast to all members (respecting zoneId if specified)
          const notifZone = row.zoneId || (raw.zoneId as string) || (raw.zone_id as string);
          if (!notifZone || notifZone === 'all' || notifZone === 'global' || isHqAdmin) {
            visible = true;
          } else if (userZone && notifZone) {
            const uNorm = userZone.replace(/-/g, '').toLowerCase();
            const nNorm = notifZone.replace(/-/g, '').toLowerCase();
            if (uNorm === nNorm || userZone.toLowerCase() === notifZone.toLowerCase()) {
              visible = true;
            }
          }
        } else if (isAdmin) {
          visible = true;
        }

        if (!visible) return null;

        const title = row.title || (raw.title as string) || (merged.title as string) || 'Broadcast Notification';
        const message = row.message || (raw.message as string) || (raw.body as string) || (raw.text as string) || (merged.message as string) || (merged.body as string) || '';
        const body = (raw.body as string) || message;
        const category = row.category || (raw.category as string) || (merged.category as string) || 'general';
        const priority = row.priority || (raw.priority as string) || (merged.priority as string) || 'normal';
        const senderName = (raw.sender_name as string) || (raw.senderName as string) || (raw.sentBy as string) || (merged.sender_name as string) || (merged.senderName as string) || 'HQ Administrator';
        const sentBy = senderName;
        const createdAt = row.createdAt || (raw.created_at as string) || (raw.createdAt as string) || (merged.created_at as string) || new Date().toISOString();

        return {
          ...merged,
          id: row.id,
          title,
          message,
          body,
          category,
          priority,
          senderName,
          sentBy,
          targetAudience: audience,
          target_audience: audience,
          createdAt,
          created_at: createdAt,
          sentAt: createdAt,
          is_read: readIds.has(row.id),
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[notifications:GET]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /notifications/:id — get single notification */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }
    const merged = mergeRawRow(row);
    const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, unknown>) : {};
    const title = row.title || (raw.title as string) || (merged.title as string) || 'Broadcast Notification';
    const message = row.message || (raw.message as string) || (raw.body as string) || (raw.text as string) || (merged.message as string) || '';
    const body = (raw.body as string) || message;
    const category = row.category || (raw.category as string) || 'general';
    const priority = row.priority || (raw.priority as string) || 'normal';
    const senderName = (raw.sender_name as string) || (raw.senderName as string) || (raw.sentBy as string) || 'HQ Administrator';

    res.json({
      success: true,
      data: {
        ...merged,
        id: row.id,
        title,
        message,
        body,
        category,
        priority,
        senderName,
        sentBy: senderName,
      },
    });
  } catch (err) {
    console.error('[notifications/:id GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notification' });
  }
});

/** Handler for creating broadcast notification (CREATE) */
const createBroadcastHandler = async (req: any, res: any) => {
  try {
    const auth = res.locals.auth;
    const body = req.body || {};
    const { title, message, body: altBody, type, category, priority, targetAudience, targetZoneId, targetUserId, senderId, senderName, actionUrl } = body;

    const notifTitle = (title || '').trim();
    const notifMessage = (message || altBody || '').trim();

    if (!notifTitle || !notifMessage) {
      res.status(400).json({ success: false, error: 'Title and message are required' });
      return;
    }

    const id = body.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const sName = senderName || auth.name || auth.email || 'HQ Administrator';

    const rawData = {
      ...body,
      id,
      title: notifTitle,
      message: notifMessage,
      body: notifMessage,
      type: type || 'info',
      category: category || 'general',
      priority: priority || 'normal',
      target_audience: targetAudience || 'all',
      target_zone_id: targetZoneId || null,
      target_user_id: targetUserId || null,
      sender_id: senderId || auth.userId,
      sender_name: sName,
      sentBy: sName,
      created_at: now,
      createdAt: now,
      sentAt: now,
      is_read: false,
    };

    const newRecord = {
      id,
      title: notifTitle,
      message: notifMessage,
      type: type || 'info',
      category: category || 'general',
      priority: priority || 'normal',
      targetAudience: targetAudience || 'all',
      targetUserId: targetUserId || null,
      zoneId: targetZoneId || null,
      senderId: senderId || auth.userId,
      actionUrl: actionUrl || null,
      isRead: false,
      createdAt: now,
      rawData,
    };

    await db.insert(notifications).values(newRecord);

    res.status(201).json({
      success: true,
      message: 'Broadcast notification published successfully',
      data: mergeRawRow(newRecord),
    });
  } catch (err) {
    console.error('[notifications:CREATE]', err);
    res.status(500).json({ success: false, error: 'Failed to create broadcast notification' });
  }
};

/** POST /notifications & POST /notifications/broadcast (CREATE) */
router.post('/', requireAuth, createBroadcastHandler);
router.post('/broadcast', requireAuth, createBroadcastHandler);

/** PATCH /notifications/:id — update read state or update notification fields (UPDATE) */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const notifId = req.params.id;
    const { is_read, title, message, body, priority, category, targetAudience, targetZoneId } = req.body;

    // 1. Read receipt toggle
    if (is_read !== undefined) {
      if (is_read === true) {
        const receiptId = `${userId}_${notifId}`;
        const [existing] = await db
          .select()
          .from(userNotifications)
          .where(eq(userNotifications.id, receiptId))
          .limit(1);

        if (!existing) {
          await db.insert(userNotifications).values({
            id: receiptId,
            rawData: {
              user_id: userId,
              notification_id: notifId,
              read_at: new Date().toISOString(),
            },
          });
        }
      } else {
        await db.delete(userNotifications).where(eq(userNotifications.id, `${userId}_${notifId}`));
      }
    }

    // 2. Admin field update (title, message, category, priority, etc.)
    if (title !== undefined || message !== undefined || body !== undefined || category !== undefined || priority !== undefined) {
      const [existingRow] = await db.select().from(notifications).where(eq(notifications.id, notifId)).limit(1);
      if (existingRow) {
        const oldRaw = (existingRow.rawData && typeof existingRow.rawData === 'object') ? existingRow.rawData : {};
        const updatedRaw = {
          ...oldRaw,
          ...(title !== undefined ? { title: title.trim() } : {}),
          ...(message !== undefined ? { message: message.trim(), body: message.trim() } : {}),
          ...(body !== undefined ? { body: body.trim(), message: body.trim() } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(targetAudience !== undefined ? { target_audience: targetAudience } : {}),
          ...(targetZoneId !== undefined ? { target_zone_id: targetZoneId } : {}),
          updated_at: new Date().toISOString(),
        };

        await db
          .update(notifications)
          .set({
            ...(title !== undefined ? { title: title.trim() } : {}),
            ...(message !== undefined ? { message: message.trim() } : {}),
            ...(category !== undefined ? { category } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(targetAudience !== undefined ? { targetAudience } : {}),
            ...(targetZoneId !== undefined ? { zoneId: targetZoneId } : {}),
            rawData: updatedRaw,
          })
          .where(eq(notifications.id, notifId));
      }
    }

    res.json({ success: true, message: 'Notification updated successfully' });
  } catch (err) {
    console.error('[notifications/:id PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** PUT /notifications/:id (UPDATE) */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const notifId = req.params.id;
    const { title, message, body, priority, category, targetAudience, targetZoneId } = req.body;

    const [existingRow] = await db.select().from(notifications).where(eq(notifications.id, notifId)).limit(1);
    if (!existingRow) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    const oldRaw = (existingRow.rawData && typeof existingRow.rawData === 'object') ? existingRow.rawData : {};
    const updatedRaw = {
      ...oldRaw,
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(message !== undefined ? { message: message.trim(), body: message.trim() } : {}),
      ...(body !== undefined ? { body: body.trim(), message: body.trim() } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(targetAudience !== undefined ? { target_audience: targetAudience } : {}),
      ...(targetZoneId !== undefined ? { target_zone_id: targetZoneId } : {}),
      updated_at: new Date().toISOString(),
    };

    await db
      .update(notifications)
      .set({
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(message !== undefined ? { message: message.trim() } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(targetAudience !== undefined ? { targetAudience } : {}),
        ...(targetZoneId !== undefined ? { zoneId: targetZoneId } : {}),
        rawData: updatedRaw,
      })
      .where(eq(notifications.id, notifId));

    res.json({ success: true, message: 'Notification updated successfully' });
  } catch (err) {
    console.error('[notifications/:id PUT]', err);
    res.status(500).json({ success: false, error: 'Failed to update notification' });
  }
});

/** DELETE /notifications/:id — delete a notification (DELETE) */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(notifications).where(eq(notifications.id, id));
    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (err) {
    console.error('[notifications/:id DELETE]', err);
    res.status(500).json({ success: false, error: 'Failed to delete notification' });
  }
});

/** PATCH /notifications/read-all — mark all visible notifications read for this user */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;

    const notifRows = await db.select({ id: notifications.id }).from(notifications);

    const existingReceipts = await db
      .select({ id: userNotifications.id })
      .from(userNotifications)
      .where(sql`${userNotifications.id} LIKE ${userId + '_%'}`);
    const existingIds = new Set(existingReceipts.map((r) => r.id));

    const toInsert = notifRows
      .filter((n) => !existingIds.has(`${userId}_${n.id}`))
      .map((n) => ({
        id: `${userId}_${n.id}`,
        rawData: {
          user_id: userId,
          notification_id: n.id,
          read_at: new Date().toISOString(),
        },
      }));

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 50) {
        await db.insert(userNotifications).values(toInsert.slice(i, i + 50));
      }
    }

    res.json({ success: true, marked: toInsert.length });
  } catch (err) {
    console.error('[notifications/read-all PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** POST /notifications/send — Expo push broadcast */
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { recipientIds, title, body, data } = req.body;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      res.status(400).json({ success: false, error: 'recipientIds array is required' });
      return;
    }

    const { inArray } = await import('drizzle-orm');

    const targetProfiles = await db
      .select({ id: profiles.id, rawData: profiles.rawData })
      .from(profiles)
      .where(inArray(profiles.id, recipientIds));

    const expoTokens: string[] = [];
    for (const p of targetProfiles) {
      const token = (p.rawData as any)?.expo_push_token || (p.rawData as any)?.expoPushToken;
      if (token && typeof token === 'string' && token.startsWith('ExponentPushToken')) {
        expoTokens.push(token);
      }
    }

    if (expoTokens.length === 0) {
      res.json({ success: true, message: 'No valid push tokens found for recipients.' });
      return;
    }

    const payload = expoTokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: data || {},
      channelId: 'default',
      priority: 'high',
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload.length === 1 ? payload[0] : payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('[notifications/send] Expo Push API Error:', errText);
    }

    res.json({ success: true, message: 'Push notifications queued to Expo.' });
  } catch (err) {
    console.error('[notifications/send]', err);
    res.status(500).json({ success: false, error: 'Failed to send push notifications.' });
  }
});

/** DELETE /notifications/:id — soft-delete (remove from user's view) */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const { id } = req.params;

    // Mark as read AND store a dismiss receipt so it doesn't reappear
    const receiptId = `${userId}_${id}`;
    const existingReceipt = await db
      .select({ id: userNotifications.id })
      .from(userNotifications)
      .where(eq(userNotifications.id, receiptId))
      .limit(1);

    if (existingReceipt.length === 0) {
      await db.insert(userNotifications).values({
        id: receiptId,
        rawData: {
          user_id: userId,
          notification_id: id,
          read_at: new Date().toISOString(),
          dismissed: true,
        },
      });
    } else {
      await db.update(userNotifications).set({
        rawData: {
          user_id: userId,
          notification_id: id,
          read_at: new Date().toISOString(),
          dismissed: true,
        },
      }).where(eq(userNotifications.id, receiptId));
    }

    res.json({ success: true, message: 'Notification dismissed' });
  } catch (err) {
    console.error('[notifications/:id DELETE]', err);
    res.status(500).json({ success: false, error: 'Failed to dismiss notification' });
  }
});

export default router;
