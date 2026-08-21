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
router.get('/:id', async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }
    const [row] = await db.select().from(settings).where(eq(settings.id, parsed.data)).limit(1);
    if (!row) {
      res.json({ success: true, data: null });
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
    console.error('[settings/:id:get]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** PUT /settings/:id — Update or create app / geofence setting */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }

    const id = parsed.data;
    const bodyData = req.body || {};
    const now = new Date().toISOString();

    const [existing] = await db.select().from(settings).where(eq(settings.id, id)).limit(1);

    const mergedData = {
      ...(existing ? mergeRawRow(existing) : {}),
      ...bodyData,
      id,
      updatedAt: now,
    };

    if (existing) {
      await db
        .update(settings)
        .set({
          rawData: mergedData,
          updatedAt: new Date(),
        })
        .where(eq(settings.id, id));
    } else {
      await db.insert(settings).values({
        id,
        rawData: mergedData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    res.json({ success: true, data: mergedData });
  } catch (err) {
    console.error('[settings/:id:put]', err);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

/** PATCH /settings/:id — Partial update setting */
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }

    const id = parsed.data;
    const bodyData = req.body || {};
    const now = new Date().toISOString();

    const [existing] = await db.select().from(settings).where(eq(settings.id, id)).limit(1);

    const mergedData = {
      ...(existing ? mergeRawRow(existing) : {}),
      ...bodyData,
      id,
      updatedAt: now,
    };

    if (existing) {
      await db
        .update(settings)
        .set({
          rawData: mergedData,
          updatedAt: new Date(),
        })
        .where(eq(settings.id, id));
    } else {
      await db.insert(settings).values({
        id,
        rawData: mergedData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    res.json({ success: true, data: mergedData });
  } catch (err) {
    console.error('[settings/:id:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

export default router;
