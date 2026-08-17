import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { calls } from '../schema';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

router.get('/:callId', requireAuth, async (req, res) => {
  const [call] = await db.select().from(calls).where(eq(calls.id, req.params.callId)).limit(1);
  if (!call) { res.status(404).json({ success: false, error: 'Call not found' }); return; }
  res.json({ success: true, data: call });
});

export default router;
