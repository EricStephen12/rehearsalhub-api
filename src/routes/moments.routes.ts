import { Router } from 'express';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { moments, momentLikes, momentComments, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';

const router = Router();

/**
 * Shape a moment row for the client response, adding computed fields
 */
function shapeMoment(row: any, userHasLiked = false) {
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};
  const mediaUrls = Array.isArray(row.mediaUrls) ? row.mediaUrls : (Array.isArray(raw.mediaUrls) ? raw.mediaUrls : []);
  const tags = Array.isArray(row.tags) ? row.tags : (Array.isArray(raw.tags) ? raw.tags : []);

  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName || raw.userName || 'Choir Member',
    userAvatar: row.userAvatar || raw.userAvatar || null,
    zoneId: row.zoneId || raw.zoneId || 'hq',
    zoneName: row.zoneName || raw.zoneName || 'Loveworld Singers HQ',
    type: row.type || 'photo',
    mediaUrls,
    caption: row.caption || '',
    tags,
    songId: row.songId || null,
    songTitle: row.songTitle || null,
    likesCount: Number(row.likesCount || 0),
    commentsCount: Number(row.commentsCount || 0),
    sharesCount: Number(row.sharesCount || 0),
    isPinned: Boolean(row.isPinned),
    hasLiked: Boolean(userHasLiked),
    createdAt: row.createdAt || raw.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * GET /moments — Paginated feed of rehearsal moments
 * Query options:
 * - feed: 'global' | 'zone' (defaults to global)
 * - zoneId: specific zone ID
 * - page: number (default 1)
 * - limit: number (default 20, max 50)
 * - tag: filter by hashtag
 * - userId: filter by creator
 */
router.get('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { feed = 'global', zoneId, page = '1', limit = '20', tag, userId } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = db.select().from(moments);

    const conditions: any[] = [];

    // Filter by specific user
    if (userId) {
      conditions.push(eq(moments.userId, String(userId)));
    }

    // Filter by zone if 'zone' feed is selected or specific zone requested
    if (feed === 'zone' && (zoneId || auth.zoneId)) {
      const targetZone = String(zoneId || auth.zoneId);
      conditions.push(eq(moments.zoneId, targetZone));
    } else if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      conditions.push(eq(moments.zoneId, String(zoneId)));
    }

    // Filter by hashtag
    if (tag) {
      const cleanTag = String(tag).startsWith('#') ? String(tag) : `#${tag}`;
      conditions.push(sql`${moments.tags}::jsonb @> ${JSON.stringify([cleanTag])}::jsonb`);
    }

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(moments.isPinned), desc(moments.createdAt)).limit(limitNum).offset(offset)
      : await query.orderBy(desc(moments.isPinned), desc(moments.createdAt)).limit(limitNum).offset(offset);

    // Fetch current user's likes for these moments in one batch
    let userLikedMomentIds = new Set<string>();
    if (rows.length > 0 && currentUserId) {
      const momentIds = rows.map(r => r.id);
      const likes = await db
        .select({ momentId: momentLikes.momentId })
        .from(momentLikes)
        .where(
          and(
            eq(momentLikes.userId, currentUserId),
            inArray(momentLikes.momentId, momentIds)
          )
        );
      userLikedMomentIds = new Set(likes.map(l => l.momentId));
    }

    const data = rows.map(row => shapeMoment(row, userLikedMomentIds.has(row.id)));

    res.json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        hasMore: rows.length === limitNum,
      },
    });
  } catch (err: any) {
    console.error('[moments:get]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch moments' });
  }
});

/**
 * GET /moments/:id — Single moment details with comments
 */
router.get('/:id', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { id } = req.params;

    const [row] = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const [userLike] = await db
      .select()
      .from(momentLikes)
      .where(and(eq(momentLikes.momentId, id), eq(momentLikes.userId, auth.userId)))
      .limit(1);

    const comments = await db
      .select()
      .from(momentComments)
      .where(eq(momentComments.momentId, id))
      .orderBy(desc(momentComments.createdAt))
      .limit(50);

    const shaped = shapeMoment(row, Boolean(userLike));
    res.json({
      success: true,
      data: {
        ...shaped,
        comments,
      },
    });
  } catch (err: any) {
    console.error('[moments/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to load moment' });
  }
});

/**
 * POST /moments — Create a new moment (photo, video reel, audio snippet)
 */
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId;
    const {
      type = 'photo',
      mediaUrls = [],
      caption = '',
      tags = [],
      songId,
      songTitle,
      zoneId,
      zoneName,
    } = req.body;

    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      res.status(400).json({ success: false, error: 'At least one media file (image/video/audio) is required' });
      return;
    }

    // Get author profile details
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    const rawProfile = (profile?.rawData && typeof profile.rawData === 'object') ? (profile.rawData as Record<string, any>) : {};

    const firstName = profile?.firstName || rawProfile.first_name || '';
    const lastName = profile?.lastName || rawProfile.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || rawProfile.name || auth.email || 'Singer';
    const avatar = profile?.avatarUrl || rawProfile.avatar_url || rawProfile.profile_image_url || null;
    const effectiveZoneId = zoneId || rawProfile.zone_code || auth.zoneId || 'hq';
    const effectiveZoneName = zoneName || rawProfile.zone_name || 'Loveworld Singers';

    const id = `moment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();

    const rawData = {
      id,
      userId,
      userName: fullName,
      userAvatar: avatar,
      zoneId: effectiveZoneId,
      zoneName: effectiveZoneName,
      type,
      mediaUrls,
      caption: caption.trim(),
      tags: Array.isArray(tags) ? tags : [],
      songId: songId || null,
      songTitle: songTitle || null,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      createdAt: now.toISOString(),
    };

    const [inserted] = await db
      .insert(moments)
      .values({
        id,
        userId,
        userName: fullName,
        userAvatar: avatar,
        zoneId: effectiveZoneId,
        zoneName: effectiveZoneName,
        type,
        mediaUrls,
        caption: caption.trim(),
        tags: Array.isArray(tags) ? tags : [],
        songId: songId || null,
        songTitle: songTitle || null,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        rawData,
      })
      .returning();

    const shaped = shapeMoment(inserted, false);

    // Broadcast new moment in real-time over WebSocket
    broadcast('new_moment', effectiveZoneId, shaped);

    res.status(201).json({
      success: true,
      message: 'Moment posted successfully',
      data: shaped,
    });
  } catch (err: any) {
    console.error('[moments:post]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to create moment' });
  }
});

/**
 * POST /moments/:id/like — Toggle like / unlike ❤️
 */
router.post('/:id/like', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId;
    const { id: momentId } = req.params;

    const [moment] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const likeId = `${momentId}_${userId}`;
    const [existingLike] = await db.select().from(momentLikes).where(eq(momentLikes.id, likeId)).limit(1);

    let liked = false;
    let newLikesCount = Math.max(0, Number(moment.likesCount || 0));

    if (existingLike) {
      // Unlike
      await db.delete(momentLikes).where(eq(momentLikes.id, likeId));
      newLikesCount = Math.max(0, newLikesCount - 1);
      liked = false;
    } else {
      // Like
      const [userProfile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      const rawP = (userProfile?.rawData && typeof userProfile.rawData === 'object') ? (userProfile.rawData as Record<string, any>) : {};
      const userName = `${userProfile?.firstName || ''} ${userProfile?.lastName || ''}`.trim() || rawP.name || auth.email || 'Singer';
      const userAvatar = userProfile?.avatarUrl || rawP.avatar_url || null;

      await db.insert(momentLikes).values({
        id: likeId,
        momentId,
        userId,
        userName,
        userAvatar,
        createdAt: new Date(),
      });
      newLikesCount += 1;
      liked = true;
    }

    // Atomically update moment like count
    await db.update(moments).set({ likesCount: newLikesCount }).where(eq(moments.id, momentId));

    // Broadcast like count update
    broadcast('moment_liked', momentId, { momentId, likesCount: newLikesCount });

    res.json({
      success: true,
      liked,
      likesCount: newLikesCount,
    });
  } catch (err: any) {
    console.error('[moments:like]', err);
    res.status(500).json({ success: false, error: 'Failed to update like' });
  }
});

/**
 * GET /moments/:id/comments — Get comments thread
 */
router.get('/:id/comments', requireAuth, async (req: any, res) => {
  try {
    const { id: momentId } = req.params;
    const commentsList = await db
      .select()
      .from(momentComments)
      .where(eq(momentComments.momentId, momentId))
      .orderBy(desc(momentComments.createdAt));

    res.json({
      success: true,
      count: commentsList.length,
      data: commentsList,
    });
  } catch (err: any) {
    console.error('[moments:comments:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load comments' });
  }
});

/**
 * POST /moments/:id/comments — Add a comment 💬
 */
router.post('/:id/comments', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId;
    const { id: momentId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ success: false, error: 'Comment content cannot be empty' });
      return;
    }

    const [moment] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const [userProfile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    const rawP = (userProfile?.rawData && typeof userProfile.rawData === 'object') ? (userProfile.rawData as Record<string, any>) : {};
    const userName = `${userProfile?.firstName || ''} ${userProfile?.lastName || ''}`.trim() || rawP.name || auth.email || 'Singer';
    const userAvatar = userProfile?.avatarUrl || rawP.avatar_url || null;

    const commentId = `comment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();

    const [newComment] = await db
      .insert(momentComments)
      .values({
        id: commentId,
        momentId,
        userId,
        userName,
        userAvatar,
        content: content.trim(),
        createdAt: now,
        rawData: {
          id: commentId,
          momentId,
          userId,
          userName,
          userAvatar,
          content: content.trim(),
          createdAt: now.toISOString(),
        },
      })
      .returning();

    // Increment comments count on the moment
    const newCommentsCount = Number(moment.commentsCount || 0) + 1;
    await db.update(moments).set({ commentsCount: newCommentsCount }).where(eq(moments.id, momentId));

    // Broadcast new comment
    broadcast('new_moment_comment', momentId, { momentId, comment: newComment, commentsCount: newCommentsCount });

    res.status(201).json({
      success: true,
      message: 'Comment posted',
      data: newComment,
    });
  } catch (err: any) {
    console.error('[moments:comments:post]', err);
    res.status(500).json({ success: false, error: 'Failed to post comment' });
  }
});

/**
 * DELETE /moments/:id — Delete a moment (Owner or Admin)
 */
router.delete('/:id', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { id } = req.params;

    const [moment] = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const isOwner = moment.userId === auth.userId;
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';

    if (!isOwner && !isAdmin) {
      res.status(403).json({ success: false, error: 'You do not have permission to delete this moment' });
      return;
    }

    // Cascade delete likes and comments
    await db.delete(momentLikes).where(eq(momentLikes.momentId, id));
    await db.delete(momentComments).where(eq(momentComments.momentId, id));
    await db.delete(moments).where(eq(moments.id, id));

    broadcast('moment_deleted', moment.zoneId || 'hq', { id });

    res.json({
      success: true,
      message: 'Moment deleted successfully',
    });
  } catch (err: any) {
    console.error('[moments:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete moment' });
  }
});

export default router;
