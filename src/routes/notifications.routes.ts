import { Router } from 'express';
import { desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { notifications, userGroups, userNotifications } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /notifications — scoped list with is_read (reads Supabase only). */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;

    const [notifRows, groupRows, readRows] = await Promise.all([
      db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(50),
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
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { recipientIds, title, body, data } = req.body;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
       res.status(400).json({ success: false, error: 'recipientIds array is required' });
       return;
    }

    const { inArray } = await import('drizzle-orm');
    const { profiles } = await import('../schema');

    // Fetch the rawData for the recipient profiles to get their expo_push_token
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
      // Nobody to send to, but we succeeded in processing the request
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
