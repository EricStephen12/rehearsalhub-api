import { Router } from 'express';
import { db } from '../db';
import { submittedSongs } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(submittedSongs);
    const data = rows
      .map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          title: typeof m.title === 'string' ? m.title : null,
          status: typeof m.status === 'string' ? m.status : 'pending',
          writer: typeof m.writer === 'string' ? m.writer : null,
          zoneName: typeof m.zoneName === 'string' ? m.zoneName : null,
          zoneId: typeof m.zoneId === 'string' ? m.zoneId : null,
          submittedBy: typeof m.submittedBy === 'string' ? m.submittedBy : null,
          createdAt: m.createdAt ?? null,
        };
      })
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[submitted-songs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
