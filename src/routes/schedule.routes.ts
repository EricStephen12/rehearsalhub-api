import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { schedulePrograms } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(schedulePrograms);
    const data = rows
      .map((r) => mergeRawRow(r))
      .sort((a, b) => {
        const ac = String(a.createdAt ?? '');
        const bc = String(b.createdAt ?? '');
        return bc.localeCompare(ac);
      });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[schedule]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:scheduleId', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(schedulePrograms)
      .where(eq(schedulePrograms.id, req.params.scheduleId))
      .limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[schedule/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
