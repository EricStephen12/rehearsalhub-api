import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { attendance } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /attendance/mine */
router.get('/mine', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db.select().from(attendance).where(eq(attendance.userId, userId));
    const data = rows.map((row) => {
      const merged = mergeRawRow(row);
      return {
        ...merged,
        id: row.id,
        userId: row.userId ?? userId,
        status: row.status ?? (merged.status as string | undefined),
        zoneId: row.zoneId ?? (merged.zoneId as string | undefined),
        checkInTime: row.checkInTime ?? (merged.check_in_time as string | undefined),
        eventName: row.eventName ?? (merged.eventName as string | undefined),
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[attendance/mine]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
