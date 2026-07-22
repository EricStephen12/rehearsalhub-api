import { Router, Request, Response } from 'express';
import { db } from '../db';
import { masterSongs } from '../schema';
import { eq, isNotNull, ne } from 'drizzle-orm';

const router = Router();

// GET /api/master-songs
// Returns all master songs with their audio URLs and full payload
router.get('/', async (req: Request, res: Response) => {
  try {
    const songs = await db
      .select({
        id: masterSongs.id,
        title: masterSongs.title,
        key: masterSongs.key,
        tempo: masterSongs.tempo,
        category: masterSongs.category,
        writer: masterSongs.writer,
        conductor: masterSongs.conductor,
        leadSinger: masterSongs.leadSinger,
        drummer: masterSongs.drummer,
        bassGuitarist: masterSongs.bassGuitarist,
        leadKeyboardist: masterSongs.leadKeyboardist,
        audioFile: masterSongs.audioFile,
        audioUrls: masterSongs.audioUrls,
        imageUrl: masterSongs.imageUrl,
        lyrics: masterSongs.lyrics,
        solfa: masterSongs.solfa,
        categories: masterSongs.categories,
        customParts: masterSongs.customParts,
        sourceType: masterSongs.sourceType,
        publishedAt: masterSongs.publishedAt,
        updatedAt: masterSongs.updatedAt,
      })
      .from(masterSongs)
      .orderBy(masterSongs.title);

    res.json({
      success: true,
      count: songs.length,
      data: songs,
    });
  } catch (error) {
    console.error('Error fetching master songs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch master songs',
    });
  }
});

// GET /api/master-songs/:id
// Returns a single master song by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [song] = await db
      .select()
      .from(masterSongs)
      .where(eq(masterSongs.id, id))
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
