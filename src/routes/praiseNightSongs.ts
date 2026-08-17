import { Router, Request, Response } from 'express';
import { db } from '../db';
import { songs } from '../schema';
import { eq } from 'drizzle-orm';

const router = Router();

// GET /api/praise-night-songs
// Returns all rehearsal / praise night songs with audio URLs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { praiseNightId, zoneId } = req.query;

    let query = db
      .select({
        id: songs.id,
        title: songs.title,
        key: songs.key,
        tempo: songs.tempo,
        category: songs.category,
        writer: songs.writer,
        conductor: songs.conductor,
        leadSinger: songs.leadSinger,
        drummer: songs.drummer,
        audioFile: songs.audioFile,
        audioUrls: songs.audioUrls,
        lyrics: songs.lyrics,
        categories: songs.categories,
        status: songs.status,
        isActive: songs.isActive,
        zoneId: songs.zoneId,
        praiseNightId: songs.praiseNightId,
        createdAt: songs.createdAt,
        updatedAt: songs.updatedAt,
      })
      .from(songs);

    const rows = await (praiseNightId
      ? query.where(eq(songs.praiseNightId, praiseNightId as string))
      : zoneId
      ? query.where(eq(songs.zoneId, zoneId as string))
      : query);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error('Error fetching praise night songs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch praise night songs',
    });
  }
});

// GET /api/praise-night-songs/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [song] = await db
      .select()
      .from(songs)
      .where(eq(songs.id, id))
      .limit(1);

    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }

    res.json({ success: true, data: song });
  } catch (error) {
    console.error('Error fetching song:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch song' });
  }
});

export default router;
