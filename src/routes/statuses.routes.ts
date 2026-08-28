import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';

const router = Router();
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function rawObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function shapeStatus(row: any, profile?: any) {
  const raw = rawObject(row.rawData);
  const createdAt = raw.createdAt || raw.created_at || new Date().toISOString();
  const expiresAt = raw.expiresAt || raw.expires_at || new Date(new Date(createdAt).getTime() + STATUS_TTL_MS).toISOString();
  return {
    id: row.id, userId: raw.userId || raw.user_id || '',
    userName: raw.userName || raw.user_name || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.email || 'Singer',
    userAvatar: raw.userAvatar || raw.user_avatar || profile?.avatarUrl || null,
    mediaUrl: raw.mediaUrl || raw.media_url || '', type: raw.type || 'image', caption: raw.caption || '',
    createdAt, expiresAt, viewers: Array.isArray(raw.viewers) ? raw.viewers : [], likes: Array.isArray(raw.likes) ? raw.likes : [], isViewed: false,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    const rows = await prisma.userStatus.findMany();
    const userIds = Array.from(new Set(rows.map((row) => rawObject(row.rawData).userId || rawObject(row.rawData).user_id).filter(Boolean))) as string[];
    const profileRows = userIds.length ? await prisma.profile.findMany({ where: { id: { in: userIds } } }) : [];
    const profileMap = new Map(profileRows.map((p) => [p.id, p]));
    const currentUserId = res.locals.auth.userId as string;
    const data = rows.map((row) => {
      const raw = rawObject(row.rawData);
      const createdAt = raw.createdAt || raw.created_at;
      const expiresAt = raw.expiresAt || raw.expires_at || (createdAt ? new Date(new Date(createdAt).getTime() + STATUS_TTL_MS).toISOString() : '');
      if (!expiresAt || new Date(expiresAt).getTime() <= now) return null;
      const status = shapeStatus(row, profileMap.get(raw.userId || raw.user_id));
      status.isViewed = status.viewers.includes(currentUserId);
      return status;
    }).filter(Boolean);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[statuses:get]', error);
    res.status(500).json({ success: false, error: 'Failed to load statuses' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { mediaUrl, type = 'image', caption = '' } = req.body || {};
    if (typeof mediaUrl !== 'string' || !mediaUrl.trim()) return res.status(400).json({ success: false, error: 'Media URL is required' });
    if (!['image', 'video'].includes(type)) return res.status(400).json({ success: false, error: 'Status type must be image or video' });
    const status = { id: crypto.randomUUID(), userId: res.locals.auth.userId as string, mediaUrl: mediaUrl.trim(), type, caption: typeof caption === 'string' ? caption.trim().slice(0, 500) : '', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + STATUS_TTL_MS).toISOString(), viewers: [] };
    await prisma.userStatus.create({ data: { id: status.id, rawData: status } });
    broadcast('statuses', 'all', { status });
    res.status(201).json({ success: true, data: status });
  } catch (error) {
    console.error('[statuses:create]', error);
    res.status(500).json({ success: false, error: 'Failed to create status' });
  }
});

router.post('/:id/view', requireAuth, async (req, res) => {
  try {
    const row = await prisma.userStatus.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ success: false, error: 'Status not found' });
    const raw = rawObject(row.rawData);
    const viewers = Array.isArray(raw.viewers) ? raw.viewers.map(String) : [];
    const userId = res.locals.auth.userId as string;
    if (!viewers.includes(userId)) viewers.push(userId);
    await prisma.userStatus.update({ where: { id: row.id }, data: { rawData: { ...raw, viewers } } });
    res.json({ success: true, data: { id: row.id, viewers } });
  } catch (error) {
    console.error('[statuses:view]', error);
    res.status(500).json({ success: false, error: 'Failed to mark status viewed' });
  }
});

router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const row = await prisma.userStatus.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ success: false, error: 'Status not found' });
    const raw = rawObject(row.rawData);
    const likes = Array.isArray(raw.likes) ? raw.likes.map(String) : [];
    const userId = res.locals.auth.userId as string;
    const liked = likes.includes(userId);
    const nextLikes = liked ? likes.filter((id) => id !== userId) : [...likes, userId];
    await prisma.userStatus.update({ where: { id: row.id }, data: { rawData: { ...raw, likes: nextLikes } } });
    broadcast('statuses', 'all', { id: row.id, likes: nextLikes });
    res.json({ success: true, data: { id: row.id, likes: nextLikes, liked: !liked } });
  } catch (error) {
    console.error('[statuses:like]', error);
    res.status(500).json({ success: false, error: 'Failed to update status like' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const row = await prisma.userStatus.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ success: false, error: 'Status not found' });
    const raw = rawObject(row.rawData);
    if (raw.userId !== res.locals.auth.userId && raw.user_id !== res.locals.auth.userId) return res.status(403).json({ success: false, error: 'Forbidden' });
    await prisma.userStatus.delete({ where: { id: row.id } });
    broadcast('statuses', 'all', { deletedId: row.id });
    res.json({ success: true });
  } catch (error) {
    console.error('[statuses:delete]', error);
    res.status(500).json({ success: false, error: 'Failed to delete status' });
  }
});

export default router;
