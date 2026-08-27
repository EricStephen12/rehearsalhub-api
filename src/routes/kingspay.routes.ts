import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { individualSubscriptions } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import crypto from 'crypto';

const router = Router();

const KINGSPAY_API_KEY = process.env.KINGSPAY_API_KEY || '';

/** 
 * POST /initialize
 * Called by the mobile app to start a payment session.
 */
router.post('/initialize', requireAuth, async (req, res) => {
  try {
    if (!KINGSPAY_API_KEY) {
      res.status(503).json({ success: false, error: 'Payments are not configured on this server.' });
      return;
    }

    const { amount, userId, userEmail, type, duration } = req.body;

    if (!amount || !userId || !type || userId !== res.locals.auth.userId) {
      res.status(400).json({ success: false, error: 'Missing required payment fields.' });
      return;
    }

    // 1. (Mock) Call KingsPay API to initialize the transaction
    // const response = await fetch('https://kingspay-api.com/v1/transaction/initialize', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${KINGSPAY_API_KEY}` },
    //   body: JSON.stringify({ amount, email: userEmail, metadata: { userId, type, duration } })
    // });
    // const data = await response.json();

    res.status(501).json({ success: false, error: 'KingsPay transaction initialization is not implemented.' });

  } catch (err) {
    console.error('[kingspay/initialize]', err);
    res.status(500).json({ success: false, error: 'Failed to initialize payment.' });
  }
});

/**
 * POST /verify
 * Provider verification must be implemented before subscriptions are activated.
 */
router.post('/verify', requireAuth, async (_req, res) => {
  res.status(501).json({
    success: false,
    error: 'KingsPay payment verification is not implemented on this server.',
  });
});

/**
 * POST /webhook
 * Called by KingsPay servers when a payment is successful.
 * This endpoint should NOT have `requireAuth` since it's called by an external server.
 */
router.post('/webhook', async (req, res) => {
  try {
    const webhookSecret = process.env.KINGSPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-kingspay-signature'];
    if (!webhookSecret || typeof signature !== 'string') {
      res.status(503).send('Webhook verification is not configured');
      return;
    }
    const expected = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex');
    const supplied = Buffer.from(signature, 'utf8');
    const calculated = Buffer.from(expected, 'utf8');
    if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) {
      res.status(401).send('Invalid webhook signature');
      return;
    }

    const { event, data } = req.body;
    
    // 2. Process successful payment event
    if (event === 'charge.success') {
      const userId = data.metadata?.userId;
      
      if (!userId) {
        console.warn('[kingspay/webhook] No userId found in payment metadata.');
        res.status(400).send('No userId in metadata');
        return;
      }

      // Calculate new expiration date (e.g., 30 days from now for monthly)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // 3. Upsert the user's subscription in the database
      const existing = await db
        .select()
        .from(individualSubscriptions)
        .where(eq(individualSubscriptions.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing subscription
        await db
          .update(individualSubscriptions)
          .set({
            status: 'active',
            plan: 'premium',
            expiresAt: expiresAt.toISOString(),
            updatedAt: new Date(),
          })
          .where(eq(individualSubscriptions.userId, userId));
      } else {
        // Create new subscription
        await db.insert(individualSubscriptions).values({
          id: crypto.randomUUID(),
          userId,
          plan: 'premium',
          status: 'active',
          expiresAt: expiresAt.toISOString(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      console.log(`[kingspay/webhook] Successfully upgraded user ${userId} to premium.`);
    }

    // Acknowledge receipt of the webhook to KingsPay
    res.status(200).send('Webhook received');
  } catch (err) {
    console.error('[kingspay/webhook]', err);
    res.status(500).send('Webhook processing failed');
  }
});

export default router;
