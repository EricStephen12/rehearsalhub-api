import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { praiseNights } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(praiseNights);
    const data = rows
      .map((r) => mergeRawRow(r))
      .sort((a, b) => {
        const ac = String(a.createdAt ?? a.date ?? '');
        const bc = String(b.createdAt ?? b.date ?? '');
        return bc.localeCompare(ac);
      });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[praise-nights]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(praiseNights)
      .where(eq(praiseNights.id, req.params.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[praise-nights/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
