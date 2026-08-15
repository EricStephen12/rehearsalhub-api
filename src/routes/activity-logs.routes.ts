import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'admin' && auth.role !== 'hq_admin' && auth.role !== 'zone_admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    // Live table is id + raw_data only (~50k rows). Timestamps are often
    // Firestore-shaped { _seconds, _nanoseconds } inside JSON.
    const result = await db.execute(sql`
      SELECT id, raw_data AS "rawData"
      FROM activity_logs
      ORDER BY COALESCE(
        (raw_data->'timestamp'->>'_seconds')::bigint,
        (raw_data->'createdAt'->>'_seconds')::bigint,
        0
      ) DESC
      LIMIT 100
    `);

    const rows = (result as unknown as Array<{ id: string; rawData: unknown }>).map((r) =>
      mergeRawRow({ id: r.id, rawData: r.rawData }),
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[activity-logs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
