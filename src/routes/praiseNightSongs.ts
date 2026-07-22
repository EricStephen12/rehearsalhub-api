import { Router, Request, Response } from 'express';
import { db } from '../db';
import { praiseNightSongs } from '../schema';
import { eq } from 'drizzle-orm';

const router = Router();

// GET /api/praise-night-songs
// Returns all praise night songs with audio URLs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { praiseNightId, zoneId } = req.query;

    let query = db
      .select({
        id: praiseNightSongs.id,
        title: praiseNightSongs.title,
        key: praiseNightSongs.key,
        tempo: praiseNightSongs.tempo,
        category: praiseNightSongs.category,
        writer: praiseNightSongs.writer,
        conductor: praiseNightSongs.conductor,
        leadSinger: praiseNightSongs.leadSinger,
        drummer: praiseNightSongs.drummer,
        audioFile: praiseNightSongs.audioFile,
        audioUrls: praiseNightSongs.audioUrls,
        lyrics: praiseNightSongs.lyrics,
        categories: praiseNightSongs.categories,
        status: praiseNightSongs.status,
        isActive: praiseNightSongs.isActive,
        zoneId: praiseNightSongs.zoneId,
        praiseNightId: praiseNightSongs.praiseNightId,
        createdAt: praiseNightSongs.createdAt,
        updatedAt: praiseNightSongs.updatedAt,
      })
      .from(praiseNightSongs);

    const songs = await (praiseNightId
      ? query.where(eq(praiseNightSongs.praiseNightId, praiseNightId as string))
      : zoneId
      ? query.where(eq(praiseNightSongs.zoneId, zoneId as string))
      : query);

    res.json({
      success: true,
      count: songs.length,
      data: songs,
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
      .from(praiseNightSongs)
      .where(eq(praiseNightSongs.id, id))
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
