import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { callsV2 } from '../schema';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

router.get('/:callId', requireAuth, async (req, res) => {
  const [call] = await db.select().from(callsV2).where(eq(callsV2.id, req.params.callId)).limit(1);
  if (!call) { res.status(404).json({ success: false, error: 'Call not found' }); return; }
  res.json({ success: true, data: call });
});

export default router;
