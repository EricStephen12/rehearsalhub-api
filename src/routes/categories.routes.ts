import { Router } from 'express';
import { db } from '../db';
import { categories } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(categories);
    const data = rows
      .map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : '',
          color: typeof m.color === 'string' ? m.color : null,
          isActive: m.isActive !== false,
          description: typeof m.description === 'string' ? m.description : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[categories]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
