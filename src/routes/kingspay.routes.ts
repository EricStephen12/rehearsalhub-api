import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { individualSubscriptions } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import crypto from 'crypto';

const router = Router();

// In a real application, you'd use your actual KingsPay API Key from environment variables.
const KINGSPAY_API_KEY = process.env.KINGSPAY_API_KEY || 'mock_key';

/** 
 * POST /initialize
 * Called by the mobile app to start a payment session.
 */
router.post('/initialize', requireAuth, async (req, res) => {
  try {
    const { amount, userId, userEmail, type, duration } = req.body;

    if (!amount || !userId || !type) {
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

    // 2. Generate a secure, unique mock payment ID
    const mockPaymentId = `kp_${crypto.randomBytes(16).toString('hex')}`;

    // For this implementation, we will simulate a successful initialization.
    res.json({
      success: true,
      payment_id: mockPaymentId,
      message: 'Payment initialized successfully.'
    });

  } catch (err) {
    console.error('[kingspay/initialize]', err);
    res.status(500).json({ success: false, error: 'Failed to initialize payment.' });
  }
});

/**
 * POST /webhook
 * Called by KingsPay servers when a payment is successful.
 * This endpoint should NOT have `requireAuth` since it's called by an external server.
 */
router.post('/webhook', async (req, res) => {
  try {
    // 1. Verify webhook signature (Mocked for now)
    // const signature = req.headers['x-kingspay-signature'];
    // if (!verifySignature(req.body, signature, process.env.KINGSPAY_WEBHOOK_SECRET)) throw new Error('Invalid sig');

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
