import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { individualSubscriptions } from '../schema';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

router.get('/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const auth = res.locals.auth;

  if (auth.userId !== userId && auth.role !== 'hq_admin') {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const [sub] = await db
    .select()
    .from(individualSubscriptions)
    .where(eq(individualSubscriptions.userId, userId))
    .limit(1);

  res.json({ success: true, data: sub ?? null });
});

export default router;
