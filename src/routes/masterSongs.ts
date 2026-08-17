import { Router, Request, Response } from 'express';
import { db } from '../db';
import { ministeredSongs } from '../schema';
import { eq } from 'drizzle-orm';

const router = Router();

// GET /api/master-songs (Ministered Songs Catalog)
router.get('/', async (req: Request, res: Response) => {
  try {
    const songs = await db
      .select({
        id: ministeredSongs.id,
        title: ministeredSongs.title,
        key: ministeredSongs.key,
        tempo: ministeredSongs.tempo,
        category: ministeredSongs.category,
        writer: ministeredSongs.writer,
        conductor: ministeredSongs.conductor,
        leadSinger: ministeredSongs.leadSinger,
        drummer: ministeredSongs.drummer,
        bassGuitarist: ministeredSongs.bassGuitarist,
        leadKeyboardist: ministeredSongs.leadKeyboardist,
        audioFile: ministeredSongs.audioFile,
        audioUrls: ministeredSongs.audioUrls,
        imageUrl: ministeredSongs.imageUrl,
        lyrics: ministeredSongs.lyrics,
        solfa: ministeredSongs.solfa,
        categories: ministeredSongs.categories,
        customParts: ministeredSongs.customParts,
        sourceType: ministeredSongs.sourceType,
        publishedAt: ministeredSongs.publishedAt,
        updatedAt: ministeredSongs.updatedAt,
      })
      .from(ministeredSongs)
      .orderBy(ministeredSongs.title);

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
      .from(ministeredSongs)
      .where(eq(ministeredSongs.id, id))
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
