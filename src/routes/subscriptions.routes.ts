import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { individualSubscriptions, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /subscriptions — Admin list all subscriptions */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    if (!isHqAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [subs, allProfiles] = await Promise.all([
      db.select().from(individualSubscriptions),
      db.select().from(profiles),
    ]);

    const profileMap = new Map<string, any>();
    for (const p of allProfiles) {
      profileMap.set(p.id, p);
    }

    const data = subs.map((s) => {
      const p = profileMap.get(s.userId);
      const rawP = (p?.rawData && typeof p.rawData === 'object') ? (p.rawData as Record<string, any>) : {};
      const rawS = (s.rawData && typeof s.rawData === 'object') ? (s.rawData as Record<string, any>) : {};

      const fullName = [p?.firstName, p?.lastName].filter(Boolean).join(' ') || (rawP.first_name ? `${rawP.first_name} ${rawP.last_name || ''}` : '') || 'Singer';
      const email = p?.email || rawP.email || '';
      const zoneName = rawP.zoneName || rawP.zone_name || rawP.zone_code || 'Assigned Zone';

      return {
        payment: {
          id: s.id,
          userId: s.userId,
          userEmail: email,
          userName: fullName,
          amount: rawS.amount || (s.plan === 'yearly' ? 12000 : 1500),
          currency: rawS.currency || 'USD',
          status: s.status === 'active' ? 'success' : s.status === 'expired' ? 'refunded' : 'pending',
          subscriptionType: s.tier || 'individual',
          subscriptionPeriod: {
            start: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
            end: s.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
          },
          metadata: {
            zoneId: rawP.zone_code || rawP.zoneId,
            zoneName,
          },
          createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
        },
        subscription: {
          id: s.id,
          userId: s.userId,
          status: s.status || 'active',
          tier: s.tier || 'premium',
          plan: s.plan || 'monthly',
          expiresAt: s.expiresAt,
        },
      };
    });

    res.json({ success: true, count: data.length, data, subscriptions: data });
  } catch (err) {
    console.error('[subscriptions:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load subscriptions' });
  }
});

/** GET /subscriptions/:userId */
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;

    if (auth.userId !== userId && auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [sub] = await db
      .select()
      .from(individualSubscriptions)
      .where(eq(individualSubscriptions.userId, userId))
      .limit(1);

    res.json({ success: true, data: sub ?? null });
  } catch (err) {
    console.error('[subscriptions:userId]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

/** POST /subscriptions/:userId/extend */
router.post('/:userId/extend', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { months = 1 } = req.body;
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const [sub] = await db.select().from(individualSubscriptions).where(eq(individualSubscriptions.userId, userId)).limit(1);
    if (!sub) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }

    const currentExpiry = sub.expiresAt ? new Date(sub.expiresAt) : new Date();
    const newExpiry = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + Number(months))).toISOString();

    await db.update(individualSubscriptions)
      .set({ expiresAt: newExpiry, status: 'active', updatedAt: new Date() })
      .where(eq(individualSubscriptions.userId, userId));

    res.json({ success: true, message: `Subscription extended by ${months} month(s)`, expiresAt: newExpiry });
  } catch (err) {
    console.error('[subscriptions:extend]', err);
    res.status(500).json({ success: false, error: 'Failed to extend subscription' });
  }
});

/** POST /subscriptions/:userId/revoke */
router.post('/:userId/revoke', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.userId !== userId && auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await db.update(individualSubscriptions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(individualSubscriptions.userId, userId));

    res.json({ success: true, message: 'Subscription revoked' });
  } catch (err) {
    console.error('[subscriptions:revoke]', err);
    res.status(500).json({ success: false, error: 'Failed to revoke subscription' });
  }
});

export default router;
