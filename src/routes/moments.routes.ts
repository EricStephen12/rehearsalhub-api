import { Router } from 'express';
import { eq, desc, and, sql, inArray, not } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { moments, momentLikes, momentComments, userFollows, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';

const router = Router();

/**
 * Shape a moment row for the client response, adding computed fields
 */
function shapeMoment(row: any, userHasLiked = false, isFollowingAuthor = false) {
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
    isFollowingAuthor: Boolean(isFollowingAuthor),
    createdAt: row.createdAt || raw.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * GET /moments — Algorithmic TikTok/Instagram style Feed
 * 
 * Feeds:
 * - feed: 'fyp' | 'following' | 'all' (default: 'fyp')
 * - page: number (default 1)
 * - limit: number (default 20)
 * - tag: filter by hashtag
 * - userId: filter by author
 */
router.get('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { feed = 'fyp', page = '1', limit = '20', tag, userId, zoneId } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // 1. Fetch current user's followed singer IDs
    let followingUserIds: string[] = [];
    if (currentUserId) {
      const followRows = await db
        .select({ followingId: userFollows.followingId })
        .from(userFollows)
        .where(eq(userFollows.followerId, currentUserId));
      followingUserIds = followRows.map(f => f.followingId);
    }
    const followingSet = new Set(followingUserIds);

    const conditions: any[] = [];

    // Filter by specific author
    if (userId) {
      conditions.push(eq(moments.userId, String(userId)));
    }

    // Following Feed logic
    if (feed === 'following') {
      if (followingUserIds.length === 0) {
        // User follows no one yet
        res.json({
          success: true,
          data: [],
          pagination: { page: pageNum, limit: limitNum, hasMore: false },
          message: 'You are not following anyone yet. Discover choir singers in the For You feed!'
        });
        return;
      }
      conditions.push(inArray(moments.userId, followingUserIds));
    }

    // Filter by hashtag
    if (tag) {
      const cleanTag = String(tag).startsWith('#') ? String(tag) : `#${tag}`;
      conditions.push(sql`${moments.tags}::jsonb @> ${JSON.stringify([cleanTag])}::jsonb`);
    }

    if (zoneId && zoneId !== 'all') {
      conditions.push(eq(moments.zoneId, String(zoneId)));
    }

    let rows: any[] = [];

    if (feed === 'following') {
      // Following feed is strictly reverse-chronological
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      rows = await db
        .select()
        .from(moments)
        .where(whereClause)
        .orderBy(desc(moments.isPinned), desc(moments.createdAt))
        .limit(limitNum)
        .offset(offset);
    } else {
      // "For You" (FYP) Algorithmic Ranking Formula:
      // Score = (likes * 3 + comments * 5 + 10) / ((age_hours + 2) ^ 1.4)
      const fypScoreSql = sql`
        (
          (${moments.likesCount} * 3.0 + ${moments.commentsCount} * 5.0 + 10.0) 
          / POWER(GREATEST(0.1, EXTRACT(EPOCH FROM (NOW() - ${moments.createdAt})) / 3600.0 + 2.0), 1.4)
        )
      `;

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      rows = await db
        .select()
        .from(moments)
        .where(whereClause)
        .orderBy(desc(moments.isPinned), desc(fypScoreSql), desc(moments.createdAt))
        .limit(limitNum)
        .offset(offset);
    }

    // Fetch user's likes in one batch
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

    const data = rows.map(row => 
      shapeMoment(row, userLikedMomentIds.has(row.id), followingSet.has(row.userId))
    );

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
 * POST /moments/follow/:targetUserId — Toggle Follow/Unfollow a singer
 */
router.post('/follow/:targetUserId', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { targetUserId } = req.params;

    if (!targetUserId || targetUserId === currentUserId) {
      res.status(400).json({ success: false, error: 'Cannot follow yourself or invalid user ID' });
      return;
    }

    // Check if already following
    const [existing] = await db
      .select()
      .from(userFollows)
      .where(and(eq(userFollows.followerId, currentUserId), eq(userFollows.followingId, targetUserId)))
      .limit(1);

    let isFollowing = false;

    if (existing) {
      // Unfollow
      await db
        .delete(userFollows)
        .where(and(eq(userFollows.followerId, currentUserId), eq(userFollows.followingId, targetUserId)));
      isFollowing = false;
    } else {
      // Follow
      const followId = `${currentUserId}_${targetUserId}`;
      await db.insert(userFollows).values({
        id: followId,
        followerId: currentUserId,
        followingId: targetUserId,
        createdAt: new Date(),
      });
      isFollowing = true;
    }

    // Get total follower count for target user
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFollows)
      .where(eq(userFollows.followingId, targetUserId));

    res.json({
      success: true,
      isFollowing,
      followersCount: countRow?.count || 0,
    });
  } catch (err: any) {
    console.error('[moments:follow]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to toggle follow' });
  }
});

/**
 * GET /moments/following/ids — Get IDs of all singers the current user follows
 */
router.get('/following/ids', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;

    const rows = await db
      .select({ followingId: userFollows.followingId })
      .from(userFollows)
      .where(eq(userFollows.followerId, currentUserId));

    res.json({
      success: true,
      followingIds: rows.map(r => r.followingId),
    });
  } catch (err: any) {
    console.error('[moments:following:ids]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch following list' });
  }
});

/**
 * GET /moments/following/suggestions — Get real suggested choir members to follow
 */
router.get('/following/suggestions', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;

    // Get singers who have posted moments recently
    const recentAuthors = await db
      .select({
        userId: moments.userId,
        userName: moments.userName,
        userAvatar: moments.userAvatar,
        zoneName: moments.zoneName,
      })
      .from(moments)
      .where(not(eq(moments.userId, currentUserId)))
      .groupBy(moments.userId, moments.userName, moments.userAvatar, moments.zoneName)
      .limit(8);

    // Get current following set
    const followRows = await db
      .select({ followingId: userFollows.followingId })
      .from(userFollows)
      .where(eq(userFollows.followerId, currentUserId));
    const followingSet = new Set(followRows.map(f => f.followingId));

    const suggestions = recentAuthors.map(author => ({
      id: author.userId,
      name: author.userName || 'Choir Member',
      avatar: author.userAvatar || null,
      role: author.zoneName || 'Loveworld Singers',
      isFollowing: followingSet.has(author.userId),
    }));

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (err: any) {
    console.error('[moments:suggestions]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch suggestions' });
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

    const [userFollow] = await db
      .select()
      .from(userFollows)
      .where(and(eq(userFollows.followerId, auth.userId), eq(userFollows.followingId, row.userId)))
      .limit(1);

    res.json({
      success: true,
      data: shapeMoment(row, Boolean(userLike), Boolean(userFollow)),
    });
  } catch (err: any) {
    console.error('[moments:get:id]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch moment' });
  }
});

/**
 * POST /moments — Create a new rehearsal moment
 */
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { 
      type = 'photo', 
      mediaUrls = [], 
      caption = '', 
      tags = [], 
      songId, 
      songTitle, 
      zoneId, 
      zoneName 
    } = req.body;

    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      res.status(400).json({ success: false, error: 'At least one media file (photo/video) is required' });
      return;
    }

    const momentId = `moment_${crypto.randomUUID()}`;

    // Get user profile name and avatar
    const [userProfile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, currentUserId))
      .limit(1);

    const userName = userProfile?.firstName
      ? `${userProfile.firstName} ${userProfile.lastName || ''}`.trim()
      : (userProfile?.email?.split('@')[0] || auth.email?.split('@')[0] || 'Choir Member');

    const userAvatar = userProfile?.avatarUrl || null;

    const newMoment = {
      id: momentId,
      userId: currentUserId,
      userName,
      userAvatar,
      zoneId: zoneId || auth.zoneId || 'hq',
      zoneName: zoneName || 'Loveworld Singers HQ',
      type,
      mediaUrls,
      caption: caption.trim(),
      tags: Array.isArray(tags) ? tags : ['#LoveworldSingers'],
      songId: songId || null,
      songTitle: songTitle || null,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      rawData: { mediaUrls, tags },
    };

    await db.insert(moments).values(newMoment as any);

    // Broadcast new moment event via WebSocket
    broadcast('moments', 'all', {
      type: 'moment:created',
      data: shapeMoment(newMoment, false, false),
    });

    res.status(201).json({
      success: true,
      data: shapeMoment(newMoment, false, false),
    });
  } catch (err: any) {
    console.error('[moments:create]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to create moment' });
  }
});

/**
 * POST /moments/:id/like — Toggle Like on a moment
 */
router.post('/:id/like', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { id } = req.params;

    const [moment] = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const [existingLike] = await db
      .select()
      .from(momentLikes)
      .where(and(eq(momentLikes.momentId, id), eq(momentLikes.userId, currentUserId)))
      .limit(1);

    let liked = false;
    let newLikesCount = moment.likesCount || 0;

    if (existingLike) {
      // Unlike
      await db
        .delete(momentLikes)
        .where(and(eq(momentLikes.momentId, id), eq(momentLikes.userId, currentUserId)));
      newLikesCount = Math.max(0, newLikesCount - 1);
      liked = false;
    } else {
      // Like
      const likeId = `${id}_${currentUserId}`;
      await db.insert(momentLikes).values({
        id: likeId,
        momentId: id,
        userId: currentUserId,
        userName: auth.name || auth.email?.split('@')[0] || 'Choir Member',
        userAvatar: auth.avatarUrl || null,
        createdAt: new Date(),
      });
      newLikesCount = newLikesCount + 1;
      liked = true;
    }

    // Atomic count update
    await db
      .update(moments)
      .set({ likesCount: newLikesCount, updatedAt: new Date() })
      .where(eq(moments.id, id));

    // Broadcast live like update
    broadcast('moments', id, {
      type: 'moment:liked',
      data: { momentId: id, likesCount: newLikesCount, userId: currentUserId, liked },
    });

    res.json({
      success: true,
      liked,
      likesCount: newLikesCount,
    });
  } catch (err: any) {
    console.error('[moments:like]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to toggle like' });
  }
});

/**
 * GET /moments/:id/comments — Fetch comments under a moment
 */
router.get('/:id/comments', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const rows = await db
      .select()
      .from(momentComments)
      .where(eq(momentComments.momentId, id))
      .orderBy(desc(momentComments.createdAt));

    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        momentId: r.momentId,
        userId: r.userId,
        userName: r.userName || 'Choir Member',
        userAvatar: r.userAvatar || null,
        content: r.content,
        createdAt: r.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('[moments:comments:get]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch comments' });
  }
});

/**
 * POST /moments/:id/comments — Add a new comment
 */
router.post('/:id/comments', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ success: false, error: 'Comment content cannot be empty' });
      return;
    }

    const [moment] = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const commentId = `comment_${crypto.randomUUID()}`;

    const [userProfile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, currentUserId))
      .limit(1);

    const userName = userProfile?.firstName
      ? `${userProfile.firstName} ${userProfile.lastName || ''}`.trim()
      : (userProfile?.email?.split('@')[0] || auth.email?.split('@')[0] || 'Choir Member');

    const userAvatar = userProfile?.avatarUrl || null;

    const newComment = {
      id: commentId,
      momentId: id,
      userId: currentUserId,
      userName,
      userAvatar,
      content: content.trim(),
      createdAt: new Date(),
    };

    await db.insert(momentComments).values(newComment);

    const updatedCommentsCount = (moment.commentsCount || 0) + 1;
    await db
      .update(moments)
      .set({ commentsCount: updatedCommentsCount, updatedAt: new Date() })
      .where(eq(moments.id, id));

    // Broadcast new comment
    broadcast('moments', id, {
      type: 'moment:comment:added',
      data: { momentId: id, comment: newComment, commentsCount: updatedCommentsCount },
    });

    res.status(201).json({
      success: true,
      data: newComment,
    });
  } catch (err: any) {
    console.error('[moments:comments:post]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to post comment' });
  }
});

/**
 * DELETE /moments/:id — Delete a moment
 */
router.delete('/:id', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const currentUserId = auth.userId;
    const { id } = req.params;

    const [moment] = await db.select().from(moments).where(eq(moments.id, id)).limit(1);
    if (!moment) {
      res.status(404).json({ success: false, error: 'Moment not found' });
      return;
    }

    const isAdmin = auth.role === 'admin' || auth.role === 'boss' || auth.role === 'super_admin';
    if (moment.userId !== currentUserId && !isAdmin) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    await db.delete(momentComments).where(eq(momentComments.momentId, id));
    await db.delete(momentLikes).where(eq(momentLikes.momentId, id));
    await db.delete(moments).where(eq(moments.id, id));

    broadcast('moments', id, {
      type: 'moment:deleted',
      data: { momentId: id },
    });

    res.json({ success: true, message: 'Moment deleted successfully' });
  } catch (err: any) {
    console.error('[moments:delete]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete moment' });
  }
});

export default router;
