import { Router, Request, Response } from 'express';
import { db } from '../db';
import { ministeredSongs } from '../schema';
import { eq, asc } from 'drizzle-orm';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

// GET /master & /api/master-songs (Ministered Songs Catalog)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(ministeredSongs)
      .orderBy(asc(ministeredSongs.title));

    const songs = rows.map((r) => {
      const m = mergeRawRow(r);
      return {
        id: String(m.id),
        title: typeof m.title === 'string' ? m.title : '',
        key: typeof m.key === 'string' ? m.key : null,
        tempo: typeof m.tempo === 'string' ? m.tempo : null,
        lyrics: typeof m.lyrics === 'string' ? m.lyrics : null,
        writer: typeof m.writer === 'string' ? m.writer : null,
        solfa: typeof m.solfa === 'string' ? m.solfa : null,
        category: typeof m.category === 'string' ? m.category : null,
        categories: Array.isArray(m.categories) ? m.categories : (m.category ? [m.category] : []),
        imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl : null,
        audioFile: typeof m.audioFile === 'string' ? m.audioFile : null,
        audioUrls: m.audioUrls && typeof m.audioUrls === 'object' ? m.audioUrls : null,
        conductor: typeof m.conductor === 'string' ? m.conductor : null,
        leadSinger: typeof m.leadSinger === 'string' ? m.leadSinger : null,
        drummer: typeof m.drummer === 'string' ? m.drummer : null,
        bassGuitarist: typeof m.bassGuitarist === 'string' ? m.bassGuitarist : null,
        leadKeyboardist: typeof m.leadKeyboardist === 'string' ? m.leadKeyboardist : null,
        customParts: m.customParts && typeof m.customParts === 'object' ? m.customParts : null,
        sourceType: typeof m.sourceType === 'string' ? m.sourceType : null,
        isHqOnly: !!m.isHqOnly || !!m.is_hq_only || m.status === 'hidden' || m.status === 'hq_only',
        isHistory: !!m.isHistory || !!m.is_history || m.status === 'history' || m.status === 'archived',
        status: typeof m.status === 'string' ? m.status : (m.isHistory || m.is_history ? 'history' : (m.isHqOnly || m.is_hq_only ? 'hidden' : 'active')),
        publishedAt: m.publishedAt || null,
        updatedAt: m.updatedAt || null,
      };
    });

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

// GET /master/:id
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

    res.json({ success: true, data: mergeRawRow(song) });
  } catch (error) {
    console.error('Error fetching song:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch song' });
  }
});

// POST /master
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const songId = body.id || `master_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const row = {
      id: songId,
      title: body.title || 'Untitled Master Song',
      key: body.key || null,
      tempo: body.tempo || null,
      lyrics: body.lyrics || null,
      writer: body.writer || null,
      solfa: body.solfa || body.solfas || null,
      category: body.category || null,
      imageUrl: body.imageUrl || body.image_url || null,
      audioFile: body.audioFile || body.audio_file || null,
      audioUrls: body.audioUrls || body.audio_urls || null,
      conductor: body.conductor || null,
      leadSinger: body.leadSinger || body.lead_singer || null,
      drummer: body.drummer || null,
      bassGuitarist: body.bassGuitarist || body.bass_guitarist || null,
      leadKeyboardist: body.leadKeyboardist || body.lead_keyboardist || null,
      categories: Array.isArray(body.categories) ? body.categories : (body.category ? [body.category] : []),
      customParts: body.customParts || body.custom_parts || null,
      publishedAt: now,
      updatedAt: now,
      sourceType: body.sourceType || 'manual',
      isHqOnly: body.isHqOnly === true,
      rawData: { ...body, id: songId, createdAt: now.toISOString() },
    };

    await db.insert(ministeredSongs).values(row);
    res.status(201).json({ success: true, message: 'Master song created', data: row });
  } catch (err) {
    console.error('[master POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /master/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const songId = req.params.id;
    const body = req.body || {};

    const [existing] = await db.select().from(ministeredSongs).where(eq(ministeredSongs.id, songId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Master song not found' });
      return;
    }

    const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
    const updateFields: Record<string, any> = {
      updatedAt: new Date(),
      rawData: { ...prevRaw, ...body },
    };

    if (body.title !== undefined) updateFields.title = body.title;
    if (body.key !== undefined) updateFields.key = body.key;
    if (body.tempo !== undefined) updateFields.tempo = body.tempo;
    if (body.lyrics !== undefined) updateFields.lyrics = body.lyrics;
    if (body.writer !== undefined) updateFields.writer = body.writer;
    if (body.solfa !== undefined || body.solfas !== undefined) updateFields.solfa = body.solfa || body.solfas;
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.imageUrl !== undefined || body.image_url !== undefined) updateFields.imageUrl = body.imageUrl || body.image_url;
    if (body.audioFile !== undefined || body.audio_file !== undefined) updateFields.audioFile = body.audioFile || body.audio_file;
    if (body.audioUrls !== undefined || body.audio_urls !== undefined) updateFields.audioUrls = body.audioUrls || body.audio_urls;
    if (body.conductor !== undefined) updateFields.conductor = body.conductor;
    if (body.leadSinger !== undefined || body.lead_singer !== undefined) updateFields.leadSinger = body.leadSinger || body.lead_singer;
    if (body.drummer !== undefined) updateFields.drummer = body.drummer;
    if (body.bassGuitarist !== undefined || body.bass_guitarist !== undefined) updateFields.bassGuitarist = body.bassGuitarist || body.bass_guitarist;
    if (body.leadKeyboardist !== undefined || body.lead_keyboardist !== undefined) updateFields.leadKeyboardist = body.leadKeyboardist || body.lead_keyboardist;
    if (body.categories !== undefined) updateFields.categories = body.categories;
    if (body.customParts !== undefined || body.custom_parts !== undefined) updateFields.customParts = body.customParts || body.custom_parts;

    await db.update(ministeredSongs).set(updateFields).where(eq(ministeredSongs.id, songId));
    res.json({ success: true, message: 'Master song updated', data: { id: songId, ...updateFields } });
  } catch (err) {
    console.error('[master PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /master/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const songId = req.params.id;
    await db.delete(ministeredSongs).where(eq(ministeredSongs.id, songId));
    res.json({ success: true, message: 'Master song deleted' });
  } catch (err) {
    console.error('[master DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
