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

export default router;
