import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { settings } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();
const idSchema = z.string().min(1).max(200);

/** GET /settings/:id — geofence / app settings (raw_data table). */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const [row] = await db.select().from(settings).where(eq(settings.id, parsed.data)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    const merged = mergeRawRow(row);
    res.json({
      success: true,
      data: {
        id: row.id,
        latitude: typeof merged.latitude === 'number' ? merged.latitude : Number(merged.latitude) || undefined,
        longitude: typeof merged.longitude === 'number' ? merged.longitude : Number(merged.longitude) || undefined,
        radius: typeof merged.radius === 'number' ? merged.radius : Number(merged.radius) || undefined,
        activeEventName:
          (merged.activeEventName as string | undefined) ||
          (merged.active_event_name as string | undefined),
        ...merged,
      },
    });
  } catch (err) {
    console.error('[settings/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
