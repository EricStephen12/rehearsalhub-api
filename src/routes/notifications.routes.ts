import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { notifications, userGroups, userNotifications, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /notifications — per-user read state, audience-scoped */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;

    const [notifRows, groupRows, readRows] = await Promise.all([
      db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100),
      db
        .select()
        .from(userGroups)
        .where(sql`${userGroups.rawData}->>'user_id' = ${userId} OR ${userGroups.rawData}->>'userId' = ${userId}`),
      // Per-user read receipts stored with composite key userId_notificationId
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
        const audience =
          (row.targetAudience as string | undefined) ||
          (merged.target_audience as string | undefined) ||
          (merged.targetAudience as string | undefined) ||
          'all';
        const targetUser =
          row.targetUserId ||
          (merged.target_user_id as string | undefined) ||
          (merged.targetUserId as string | undefined);
        const targetGroup =
          (merged.target_group as string | undefined) || (merged.targetGroup as string | undefined);

        let visible = audience === 'all';
        if (audience === 'individual' && targetUser === userId) visible = true;
        if (audience === 'group' && targetGroup && groupNames.has(targetGroup)) visible = true;
        if (!visible) return null;

        return {
          ...merged,
          id: row.id,
          title: row.title ?? (merged.title as string | undefined),
          body: (merged.body as string | undefined) || row.message || (merged.message as string | undefined),
          message: row.message ?? (merged.message as string | undefined),
          target_audience: audience,
          created_at: row.createdAt ?? (merged.created_at as string | undefined),
          is_read: readIds.has(row.id),
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);

    res.json({ success: true, data });
  } catch (err) {
    console.error('[notifications]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** PATCH /notifications/:id — mark single notification read for this user */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const notifId = req.params.id;
    const { is_read } = req.body;

    if (is_read === true) {
      // Upsert a per-user read receipt using composite key
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
    } else if (is_read === false) {
      await db.delete(userNotifications).where(eq(userNotifications.id, `${userId}_${notifId}`));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[notifications/:id PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** PATCH /notifications/read-all — mark all visible notifications read for this user */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;

    // Get all notification IDs
    const notifRows = await db.select({ id: notifications.id }).from(notifications);

    // Fetch existing read receipts to avoid duplicate inserts
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
      // Insert in batches of 50
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

/** POST /notifications/broadcast — admin broadcast (creates a notification record) */
router.post('/broadcast', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const { title, message, type, category, priority, targetAudience, targetZoneId, targetUserId, senderId, senderName, actionUrl } = req.body;

    if (!title?.trim() || !message?.trim()) {
      res.status(400).json({ success: false, error: 'title and message are required' });
      return;
    }

    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(notifications).values({
      id,
      title: title.trim(),
      message: message.trim(),
      type: type || 'info',
      category: category || 'admin',
      priority: priority || 'medium',
      targetAudience: targetAudience || 'all',
      targetUserId: targetUserId || null,
      zoneId: targetZoneId || null,
      senderId: senderId || auth.userId,
      actionUrl: actionUrl || null,
      isRead: false,
      createdAt: new Date().toISOString(),
      rawData: {
        sender_name: senderName || auth.userId,
        target_zone_id: targetZoneId || null,
      },
    });

    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[notifications/broadcast]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

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

    const payload = expoTokens.map(token => ({
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
export default router;
