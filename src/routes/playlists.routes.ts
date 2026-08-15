import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { userPlaylists } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { asStringArray, mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /playlists/me */
router.get('/me', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db.select().from(userPlaylists).where(eq(userPlaylists.userId, userId));
    const data = rows.map((row) => {
      const merged = mergeRawRow(row);
      const songs = asStringArray(merged.songIds ?? merged.songs ?? row.songIds);
      return {
        id: row.id,
        userId: row.userId ?? userId,
        name: (merged.name as string) || (merged.title as string) || row.title || 'Playlist',
        title: row.title || (merged.title as string) || 'Playlist',
        songs,
        songIds: songs,
        isPublic: row.isPublic ?? false,
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[playlists/me]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
