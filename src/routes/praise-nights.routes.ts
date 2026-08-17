import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { praiseNights, zonePraiseNights } from '../schema';
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

router.get('/zone/all', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    
    // Fallback: If no zoneId passed, we can't filter effectively unless we do a massive dump, 
    // but the mobile app passes ?zoneId=... 
    let query = db.select().from(zonePraiseNights);
    
    const rows = await query;
    const data = rows
      .map(mergeRawRow)
      .filter((r: any) => !zoneId || r.zoneId === zoneId || r.zone_id === zoneId)
      .sort((a: any, b: any) => {
        const ac = String(a.createdAt ?? a.date ?? '');
        const bc = String(b.createdAt ?? b.date ?? '');
        return bc.localeCompare(ac);
      });
      
    res.json({ success: true, data });
  } catch (err) {
    console.error('[praise-nights/zone/all]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
