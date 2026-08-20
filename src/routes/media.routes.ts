import { Router } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { mediaVideos, mediaAssets, zoneMediaAssets, mediaCategories } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';
import { broadcast } from '../ws/wsServer';

const router = Router();

function parseIsoDate(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && typeof val._seconds === 'number') {
    return new Date(val._seconds * 1000).toISOString();
  }
  if (val instanceof Date) return val.toISOString();
  return new Date().toISOString();
}

function normalizeAsset(row: any, source: 'media_videos' | 'media_assets' | 'zone_media_assets'): any {
  const m = mergeRawRow(row);
  const url = String(m.url || m.videoUrl || m.video_url || '');
  const title = String(m.title || m.name || 'Untitled Asset');
  
  let detectedType = m.type || 'video';
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (detectedType === 'audio' || lowerUrl.match(/\.(mp3|wav|m4a|aac|ogg|flac|wma|3gp)$/) || lowerTitle.match(/\.(mp3|wav|m4a|aac|ogg|flac|wma|3gp)$/)) {
    detectedType = 'audio';
  } else if (detectedType === 'image' || lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|pdf)$/) || lowerTitle.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|pdf)$/)) {
    detectedType = 'image';
  } else if (detectedType === 'video' || lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be') || lowerUrl.match(/\.(mp4|webm|mov|mkv)$/)) {
    detectedType = 'video';
  } else {
    detectedType = 'video';
  }

  const isYt = Boolean(
    (m.isYoutube ?? m.is_youtube) ||
    lowerUrl.includes('youtube.com') ||
    lowerUrl.includes('youtu.be')
  );

  return {
    id: String(m.id),
    title,
    name: title,
    description: typeof m.description === 'string' ? m.description : '',
    url,
    videoUrl: url,
    type: detectedType,
    thumbnail: typeof m.thumbnail === 'string' ? m.thumbnail : null,
    size: typeof m.size === 'number' ? m.size : null,
    format: typeof m.format === 'string' ? m.format : null,
    folder: typeof m.folder === 'string' ? m.folder : 'general',
    forHq: Boolean(m.forHq ?? m.for_hq ?? m.isHqOnly),
    isYoutube: isYt,
    featured: Boolean(m.featured),
    views: typeof m.views === 'number' ? m.views : 0,
    likes: typeof m.likes === 'number' ? m.likes : 0,
    zoneId: typeof m.zoneId === 'string' ? m.zoneId : String(m.zone_id || 'global'),
    createdBy: typeof m.createdBy === 'string' ? m.createdBy : String(m.created_by || ''),
    createdByName: typeof m.createdByName === 'string' ? m.createdByName : String(m.created_by_name || ''),
    createdAt: parseIsoDate(m.createdAt || m.created_at),
    updatedAt: parseIsoDate(m.updatedAt || m.updated_at),
    source,
    rawData: m.rawData ?? null,
  };
}

// GET /media/stats - Summary counts across all 7,600+ media assets
router.get('/stats', async (_req, res) => {
  try {
    const [videoCount] = await db.select({ count: sql`count(*)` }).from(mediaVideos);
    const [assetCount] = await db.select({ count: sql`count(*)` }).from(mediaAssets);
    const [zoneAssetCount] = await db.select({ count: sql`count(*)` }).from(zoneMediaAssets);

    const total = Number(videoCount.count) + Number(assetCount.count) + Number(zoneAssetCount.count);
    res.json({
      success: true,
      data: {
        total,
        mediaVideos: Number(videoCount.count),
        mediaAssets: Number(assetCount.count),
        zoneMediaAssets: Number(zoneAssetCount.count),
      },
    });
  } catch (err) {
    console.error('[media:stats]', err);
    res.status(500).json({ success: false, error: 'Failed to compute stats' });
  }
});

// GET /media - List media with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { zoneId, type, search, featured, isHqOnly, limit = '200' } = req.query;
    const limitNum = Math.min(Number(limit) || 200, 1000);

    // Fetch from all media sources
    const [videoRows, assetRows, zoneAssetRows] = await Promise.all([
      db.select().from(mediaVideos).limit(limitNum),
      db.select().from(mediaAssets).limit(limitNum),
      db.select().from(zoneMediaAssets).limit(limitNum),
    ]);

    const combined = [
      ...videoRows.map((r) => normalizeAsset(r, 'media_videos')),
      ...assetRows.map((r) => normalizeAsset(r, 'media_assets')),
      ...zoneAssetRows.map((r) => normalizeAsset(r, 'zone_media_assets')),
    ];

    let data = combined;

    if (type && type !== 'all') {
      data = data.filter((item) => item.type === type);
    }
    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      data = data.filter((item) => !item.zoneId || item.zoneId === zoneId || item.zoneId === 'global' || item.zoneId === '');
    }
    if (featured === 'true') {
      data = data.filter((item) => item.featured);
    }
    if (isHqOnly === 'true') {
      data = data.filter((item) => item.forHq);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      data = data.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q)
      );
    }

    data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Slice to requested limit
    const finalData = data.slice(0, limitNum);

    res.json({ success: true, count: finalData.length, total: data.length, data: finalData });
  } catch (err) {
    console.error('[media:get]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch media' });
  }
});

// GET /media/categories - List media categories
router.get('/categories', async (_req, res) => {
  try {
    const rows = await db.select().from(mediaCategories);
    const data = rows.map((r) => {
      const m = mergeRawRow(r);
      return {
        id: String(m.id),
        name: m.name || 'Category',
        slug: m.slug || String(m.name || '').toLowerCase().replace(/\s+/g, '-'),
        order: typeof m.order === 'number' ? m.order : 0,
        rawData: m.rawData ?? null,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[media:categories:get]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch media categories' });
  }
});

// GET /media/:id - Single media item
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check media_videos first
    const [videoRow] = await db.select().from(mediaVideos).where(eq(mediaVideos.id, id)).limit(1);
    if (videoRow) {
      return res.json({ success: true, data: normalizeAsset(videoRow, 'media_videos') });
    }

    // Check media_assets
    const [assetRow] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
    if (assetRow) {
      return res.json({ success: true, data: normalizeAsset(assetRow, 'media_assets') });
    }

    // Check zone_media_assets
    const [zoneRow] = await db.select().from(zoneMediaAssets).where(eq(zoneMediaAssets.id, id)).limit(1);
    if (zoneRow) {
      return res.json({ success: true, data: normalizeAsset(zoneRow, 'zone_media_assets') });
    }

    res.status(404).json({ success: false, error: 'Media not found' });
  } catch (err) {
    console.error('[media:get:id]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch media item' });
  }
});

// POST /media - Create new media item
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const {
      title,
      url,
      videoUrl,
      type,
      thumbnail,
      description,
      zoneId,
      forHq,
      isYoutube,
      featured,
    } = req.body;

    const finalUrl = String(url || videoUrl || '');
    if (!title || !finalUrl) {
      return res.status(400).json({ success: false, error: 'Title and URL are required' });
    }

    const id = `media_${crypto.randomUUID()}`;
    const isYt = Boolean(isYoutube || finalUrl.includes('youtube.com') || finalUrl.includes('youtu.be'));
    const now = new Date().toISOString();

    const rawData = {
      id,
      title,
      name: title,
      url: finalUrl,
      videoUrl: finalUrl,
      type: type || 'video',
      thumbnail: thumbnail || null,
      description: description || '',
      zoneId: zoneId || 'global',
      forHq: Boolean(forHq),
      isYouTube: isYt,
      featured: Boolean(featured),
      views: 0,
      likes: 0,
      createdBy: auth?.userId || null,
      createdByName: auth?.name || auth?.email || null,
      createdAt: now,
      updatedAt: now,
    };

    // Save to mediaVideos table
    await db.insert(mediaVideos).values({
      id,
      title,
      type: type || 'video',
      videoUrl: finalUrl,
      thumbnail: thumbnail || null,
      description: description || '',
      forHq: Boolean(forHq),
      isYoutube: isYt,
      featured: Boolean(featured),
      views: 0,
      likes: 0,
      createdBy: auth?.userId || null,
      createdByName: auth?.name || auth?.email || null,
      rawData,
    });

    broadcast('media', 'all', rawData);
    broadcast('media', id, rawData);

    res.status(201).json({
      success: true,
      data: rawData,
    });
  } catch (err) {
    console.error('[media:post]', err);
    res.status(500).json({ success: false, error: 'Failed to create media' });
  }
});

// PATCH /media/:id - Update media item
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.select().from(mediaVideos).where(eq(mediaVideos.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Media item not found in media_videos' });
    }

    const m = mergeRawRow(existing);
    const updates = req.body;
    const now = new Date().toISOString();

    const updatedRaw = {
      ...m,
      ...updates,
      updatedAt: now,
    };

    await db
      .update(mediaVideos)
      .set({
        title: updates.title !== undefined ? updates.title : existing.title,
        type: updates.type !== undefined ? updates.type : existing.type,
        videoUrl: updates.url || updates.videoUrl !== undefined ? (updates.url || updates.videoUrl) : existing.videoUrl,
        thumbnail: updates.thumbnail !== undefined ? updates.thumbnail : existing.thumbnail,
        description: updates.description !== undefined ? updates.description : existing.description,
        forHq: updates.forHq !== undefined ? Boolean(updates.forHq) : existing.forHq,
        isYoutube: updates.isYoutube !== undefined ? Boolean(updates.isYoutube) : existing.isYoutube,
        featured: updates.featured !== undefined ? Boolean(updates.featured) : existing.featured,
        views: updates.views !== undefined ? updates.views : existing.views,
        likes: updates.likes !== undefined ? updates.likes : existing.likes,
        rawData: updatedRaw,
      })
      .where(eq(mediaVideos.id, id));

    broadcast('media', 'all', updatedRaw);
    broadcast('media', id, updatedRaw);

    res.json({ success: true, data: updatedRaw });
  } catch (err) {
    console.error('[media:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update media' });
  }
});

// DELETE /media/:id - Delete media item
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete across tables
    await Promise.all([
      db.delete(mediaVideos).where(eq(mediaVideos.id, id)),
      db.delete(mediaAssets).where(eq(mediaAssets.id, id)),
      db.delete(zoneMediaAssets).where(eq(zoneMediaAssets.id, id)),
    ]);

    broadcast('media', 'all', { id, deleted: true });
    broadcast('media', id, { id, deleted: true });

    res.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    console.error('[media:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete media' });
  }
});

export default router;
