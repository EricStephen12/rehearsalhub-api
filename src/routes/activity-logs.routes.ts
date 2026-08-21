import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { activityLogs } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function normalizeLog(r: any) {
  const m = mergeRawRow(r);
  const raw = (r.rawData && typeof r.rawData === 'object') ? (r.rawData as Record<string, any>) : {};

  let timestamp = raw.timestamp || raw.createdAt || raw.created_at || new Date().toISOString();
  if (timestamp && typeof timestamp === 'object' && '_seconds' in timestamp) {
    timestamp = new Date(timestamp._seconds * 1000).toISOString();
  }

  return {
    ...m,
    id: String(r.id),
    action: m.action || raw.action || raw.activity || 'Activity Recorded',
    category: m.category || raw.category || 'general',
    userId: m.userId || raw.userId || raw.user_id || 'system',
    userName: m.userName || raw.userName || raw.user_name || raw.actor_name || 'System User',
    zoneId: m.zoneId || raw.zoneId || raw.zone_code || null,
    details: m.details || raw.details || raw.description || '',
    timestamp,
    rawData: raw,
  };
}

/** GET /activity-logs — List system audit logs */
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'admin' && auth.role !== 'hq_admin' && auth.role !== 'zone_admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const { limit = '100', category, zoneId } = req.query;
    const limitNum = Math.min(parseInt(String(limit), 10) || 100, 300);

    const result = await db.execute(sql`
      SELECT id, raw_data AS "rawData"
      FROM activity_logs
      ORDER BY id DESC
      LIMIT ${limitNum}
    `);

    let rows = (result as unknown as Array<{ id: string; rawData: unknown }>).map((r) =>
      normalizeLog({ id: r.id, rawData: r.rawData }),
    );

    if (category && category !== 'all') {
      rows = rows.filter((r) => r.category === category);
    }
    if (zoneId && zoneId !== 'all') {
      rows = rows.filter((r) => r.zoneId === zoneId);
    }

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[activity-logs:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load activity logs' });
  }
});

/** POST /activity-logs — Record new activity log entry */
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const logData = {
      id,
      action: req.body.action || 'System Action',
      category: req.body.category || 'general',
      userId: auth.userId,
      userName: req.body.userName || auth.email,
      zoneId: req.body.zoneId || auth.zoneId || null,
      details: req.body.details || req.body.description || '',
      ip: req.ip || null,
      timestamp: now,
      createdAt: now,
    };

    await db.insert(activityLogs).values({
      id,
      rawData: logData,
    });

    res.status(201).json({ success: true, message: 'Activity logged', data: logData });
  } catch (err) {
    console.error('[activity-logs:post]', err);
    res.status(500).json({ success: false, error: 'Failed to record activity log' });
  }
});

export default router;
