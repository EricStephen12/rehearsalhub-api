import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../auth/auth.middleware';
import { canManageAllTenants } from '../auth/permissions';

const router = Router();

router.get('/me', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const sub = await prisma.individualSubscription.findFirst({ where: { userId } });
    res.json({ success: true, data: sub ?? null });
  } catch (err) {
    console.error('[subscriptions:me]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

router.get('/', requireAuth, async (_req, res) => {
  try {
    const auth = res.locals.auth;
    if (!canManageAllTenants(auth.role)) return res.status(403).json({ success: false, error: 'Forbidden' });

    const [subs, allProfiles] = await Promise.all([
      prisma.individualSubscription.findMany(),
      prisma.profile.findMany(),
    ]);

    const profileMap = new Map<string, any>(allProfiles.map((p) => [p.id, p]));

    const data = subs.map((s) => {
      const p = profileMap.get(s.userId);
      const rawP = (p?.rawData && typeof p.rawData === 'object') ? (p.rawData as Record<string, any>) : {};
      const rawS = (s.rawData && typeof s.rawData === 'object') ? (s.rawData as Record<string, any>) : {};
      const fullName = [p?.firstName, p?.lastName].filter(Boolean).join(' ') || (rawP.first_name ? `${rawP.first_name} ${rawP.last_name || ''}` : '') || 'Singer';
      const email = p?.email || rawP.email || '';
      const zoneName = rawP.zoneName || rawP.zone_name || rawP.zone_code || 'Assigned Zone';
      return {
        payment: { id: s.id, userId: s.userId, userEmail: email, userName: fullName, amount: rawS.amount || (s.plan === 'yearly' ? 12000 : 1500), currency: rawS.currency || 'USD', status: s.status === 'active' ? 'success' : s.status === 'expired' ? 'refunded' : 'pending', subscriptionType: s.tier || 'individual', subscriptionPeriod: { start: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(), end: s.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString() }, metadata: { zoneId: rawP.zone_code || rawP.zoneId, zoneName }, createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString() },
        subscription: { id: s.id, userId: s.userId, status: s.status || 'active', tier: s.tier || 'premium', plan: s.plan || 'monthly', expiresAt: s.expiresAt },
      };
    });

    res.json({ success: true, count: data.length, data, subscriptions: data });
  } catch (err) {
    console.error('[subscriptions:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load subscriptions' });
  }
});

router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.userId !== userId && auth.role !== 'hq_admin' && auth.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
    const sub = await prisma.individualSubscription.findFirst({ where: { userId } });
    res.json({ success: true, data: sub ?? null });
  } catch (err) {
    console.error('[subscriptions:userId]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

router.post('/:userId/extend', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { months = 1 } = req.body;
    const auth = res.locals.auth;
    if (!canManageAllTenants(auth.role)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const sub = await prisma.individualSubscription.findFirst({ where: { userId } });
    if (!sub) return res.status(404).json({ success: false, error: 'Subscription not found' });
    const currentExpiry = sub.expiresAt ? new Date(sub.expiresAt) : new Date();
    const newExpiry = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + Number(months))).toISOString();
    await prisma.individualSubscription.update({ where: { id: sub.id }, data: { expiresAt: newExpiry, status: 'active' } });
    res.json({ success: true, message: `Subscription extended by ${months} month(s)`, expiresAt: newExpiry });
  } catch (err) {
    console.error('[subscriptions:extend]', err);
    res.status(500).json({ success: false, error: 'Failed to extend subscription' });
  }
});

router.post('/:userId/revoke', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const auth = res.locals.auth;
    if (auth.userId !== userId && auth.role !== 'hq_admin' && auth.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
    await prisma.individualSubscription.updateMany({ where: { userId }, data: { status: 'cancelled' } });
    res.json({ success: true, message: 'Subscription revoked' });
  } catch (err) {
    console.error('[subscriptions:revoke]', err);
    res.status(500).json({ success: false, error: 'Failed to revoke subscription' });
  }
});

export default router;
