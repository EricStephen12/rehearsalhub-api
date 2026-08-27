import { Router } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { userPlaylists, songs, zoneSongs, ministeredSongs } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { asStringArray, mergeRawRow } from '../lib/rawRow';

const router = Router();

/** GET /playlists/me - Fetch current user's playlists */
router.get('/me', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db.select().from(userPlaylists).where(eq(userPlaylists.userId, userId));
    const data = rows.map((row) => {
      const merged = mergeRawRow(row);
      const songIds = asStringArray(merged.songIds ?? merged.songs ?? row.songIds);
      return {
        id: row.id,
        userId: row.userId ?? userId,
        name: (merged.name as string) || (merged.title as string) || row.title || 'Playlist',
        title: row.title || (merged.title as string) || 'Playlist',
        songs: songIds,
        songIds,
        isPublic: row.isPublic ?? false,
        rawData: row.rawData,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[playlists/me]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** POST /playlists - Create a new playlist */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const { name, title, songIds = [], isPublic = false, description } = req.body;
    const playlistTitle = (title || name || 'New Playlist').trim();
    const playlistId = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const newSongIds = Array.isArray(songIds) ? songIds : [];

    const [created] = await db
      .insert(userPlaylists)
      .values({
        id: playlistId,
        title: playlistTitle,
        userId,
        songIds: newSongIds,
        isPublic: Boolean(isPublic),
        rawData: {
          name: playlistTitle,
          title: playlistTitle,
          description: description || '',
          createdBy: userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();

    res.json({
      success: true,
      data: {
        id: created.id,
        name: playlistTitle,
        title: playlistTitle,
        userId,
        songIds: newSongIds,
        songs: newSongIds,
        isPublic: created.isPublic,
      },
    });
  } catch (err) {
    console.error('[playlists:POST]', err);
    res.status(500).json({ success: false, error: 'Failed to create playlist' });
  }
});

/** GET /playlists/:id - Fetch playlist details and its resolved songs (Supports Shared Playlists) */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(userPlaylists).where(eq(userPlaylists.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Playlist not found' });
      return;
    }

    const merged = mergeRawRow(row);
    const songIds = asStringArray(merged.songIds ?? merged.songs ?? row.songIds);

    let resolvedSongs: any[] = [];
    if (songIds.length > 0) {
      const [hqList, zoneList, ministeredList] = await Promise.all([
        db.select().from(songs).where(inArray(songs.id, songIds)).catch(() => []),
        db.select().from(zoneSongs).where(inArray(zoneSongs.id, songIds)).catch(() => []),
        db.select().from(ministeredSongs).where(inArray(ministeredSongs.id, songIds)).catch(() => []),
      ]);

      const songMap = new Map<string, any>();
      [...hqList, ...zoneList, ...ministeredList].forEach((s) => {
        if (!songMap.has(s.id)) {
          const m = mergeRawRow(s);
          const raw = (s.rawData && typeof s.rawData === 'object') ? (s.rawData as any) : {};
          songMap.set(s.id, {
            ...m,
            id: s.id,
            title: s.title || raw.title || 'Untitled Song',
            audioFile: s.audioFile || raw.audioFile || raw.audioUrl || (m.audioFile as string) || '',
            audioUrls: (s as any).audioUrls || raw.audioUrls || m.audioUrls || {},
            lyrics: (s as any).lyrics || raw.lyrics || m.lyrics || '',
            leadSinger: (s as any).leadSinger || raw.leadSinger || m.leadSinger || 'Loveworld Singers',
            writer: (s as any).writer || raw.writer || m.writer || '',
            key: s.key || raw.key || '',
            tempo: s.tempo || raw.tempo || '',
          });
        }
      });

      // Preserve playlist ordering
      resolvedSongs = songIds.map((sid) => songMap.get(sid)).filter(Boolean);
    }

    res.json({
      success: true,
      data: {
        id: row.id,
        userId: row.userId,
        name: (merged.name as string) || (merged.title as string) || row.title || 'Playlist',
        title: row.title || (merged.title as string) || 'Playlist',
        songIds,
        songs: resolvedSongs,
        isPublic: row.isPublic ?? true,
        rawData: row.rawData,
      },
    });
  } catch (err) {
    console.error('[playlists/:id:GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch playlist' });
  }
});

/** POST /playlists/:id/songs - Add a song to playlist */
router.post('/:id/songs', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { songId, songIds } = req.body;
    const toAdd: string[] = songIds ? asStringArray(songIds) : songId ? [String(songId)] : [];

    if (toAdd.length === 0) {
      res.status(400).json({ success: false, error: 'songId or songIds required' });
      return;
    }

    const [existing] = await db.select().from(userPlaylists).where(eq(userPlaylists.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Playlist not found' });
      return;
    }

    const merged = mergeRawRow(existing);
    const currentList = asStringArray(merged.songIds ?? merged.songs ?? existing.songIds);
    const updatedSet = new Set([...currentList, ...toAdd]);
    const updatedIds = Array.from(updatedSet);

    const raw = (existing.rawData && typeof existing.rawData === 'object') ? { ...(existing.rawData as any) } : {};
    raw.songIds = updatedIds;
    raw.updatedAt = new Date().toISOString();

    const [updated] = await db
      .update(userPlaylists)
      .set({
        songIds: updatedIds,
        rawData: raw,
      })
      .where(eq(userPlaylists.id, id))
      .returning();

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[playlists/:id/songs:POST]', err);
    res.status(500).json({ success: false, error: 'Failed to add song to playlist' });
  }
});

/** DELETE /playlists/:id/songs/:songId - Remove a song from playlist */
router.delete('/:id/songs/:songId', requireAuth, async (req, res) => {
  try {
    const { id, songId } = req.params;
    const [existing] = await db.select().from(userPlaylists).where(eq(userPlaylists.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Playlist not found' });
      return;
    }

    const merged = mergeRawRow(existing);
    const currentList = asStringArray(merged.songIds ?? merged.songs ?? existing.songIds);
    const updatedIds = currentList.filter((s) => s !== songId);

    const raw = (existing.rawData && typeof existing.rawData === 'object') ? { ...(existing.rawData as any) } : {};
    raw.songIds = updatedIds;
    raw.updatedAt = new Date().toISOString();

    const [updated] = await db
      .update(userPlaylists)
      .set({
        songIds: updatedIds,
        rawData: raw,
      })
      .where(eq(userPlaylists.id, id))
      .returning();

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[playlists/:id/songs:DELETE]', err);
    res.status(500).json({ success: false, error: 'Failed to remove song from playlist' });
  }
});

/** DELETE /playlists/:id - Delete playlist */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = res.locals.auth.userId as string;
    await db.delete(userPlaylists).where(eq(userPlaylists.id, id));
    res.json({ success: true, message: 'Playlist deleted' });
  } catch (err) {
    console.error('[playlists/:id:DELETE]', err);
    res.status(500).json({ success: false, error: 'Failed to delete playlist' });
  }
});

export default router;
