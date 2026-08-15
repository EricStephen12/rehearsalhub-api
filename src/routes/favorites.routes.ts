import { Router } from 'express';
import { eq, or } from 'drizzle-orm';
import { db } from '../db';
import { userFavorites } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { asStringArray, mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /favorites/me — songs list for the authenticated user (Supabase user_favorites). */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db
      .select()
      .from(userFavorites)
      .where(or(eq(userFavorites.id, userId), eq(userFavorites.userId, userId)));

    const songs = new Set<string>();
    for (const row of rows) {
      const merged = mergeRawRow(row);
      const fromRaw = asStringArray(merged.songs);
      if (fromRaw.length > 0) {
        for (const id of fromRaw) songs.add(id);
      } else if (typeof row.songId === 'string' && row.songId) {
        songs.add(row.songId);
      } else if (typeof merged.songId === 'string' && merged.songId) {
        songs.add(merged.songId);
      }
    }

    res.json({ success: true, data: { songs: Array.from(songs) } });
  } catch (err) {
    console.error('[favorites/me]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
