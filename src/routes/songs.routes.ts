import { Router } from 'express';
import { eq, or, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  ministeredSongs,
  songs,
  zoneSongs,
  subgroupSongs,
  zonePraiseNights,
  subgroupPraiseNights,
} from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

// GET /songs/master & /songs/ministered — ministered songs library
const getMinisteredSongsHandler = async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(ministeredSongs).orderBy(asc(ministeredSongs.title));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[songs/ministered]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};
router.get('/master', requireAuth, getMinisteredSongsHandler);
router.get('/ministered', requireAuth, getMinisteredSongsHandler);

const getMinisteredSongByIdHandler = async (req: any, res: any) => {
  try {
    const [song] = await db
      .select()
      .from(ministeredSongs)
      .where(eq(ministeredSongs.id, req.params.id))
      .limit(1);
    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }
    res.json({ success: true, data: song });
  } catch (err) {
    console.error('[songs/ministered/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};
router.get('/master/:id', requireAuth, getMinisteredSongByIdHandler);
router.get('/ministered/:id', requireAuth, getMinisteredSongByIdHandler);

// GET /songs/praise-night & GET /songs — Main Repertoire
const getSongsHandler = async (req: any, res: any) => {
  try {
    const { praiseNightId, programId, zoneId } = req.query;
    const targetProgramId = (programId || praiseNightId) as string | undefined;

    let rows: any[] = [];
    if (targetProgramId && zoneId) {
      rows = await db.select().from(songs)
        .where(or(eq(songs.praiseNightId, targetProgramId), eq(songs.zoneId, zoneId as string)))
        .orderBy(asc(songs.title));
    } else if (targetProgramId) {
      rows = await db.select().from(songs)
        .where(eq(songs.praiseNightId, targetProgramId))
        .orderBy(asc(songs.title));
    } else if (zoneId) {
      const [mainRows, zRows] = await Promise.all([
        db.select().from(songs).where(eq(songs.zoneId, zoneId as string)),
        db.select().from(zoneSongs).where(eq(zoneSongs.zoneId, zoneId as string)),
      ]);
      rows = [...mainRows, ...zRows.map(mergeRawRow)].sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''))
      );
    } else {
      rows = await db.select().from(songs).orderBy(asc(songs.title));
    }

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[songs/praise-night]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};
router.get('/praise-night', requireAuth, getSongsHandler);
router.get('/program', requireAuth, getSongsHandler);

const getSongByIdHandler = async (req: any, res: any) => {
  try {
    const [song] = await db
      .select()
      .from(songs)
      .where(eq(songs.id, req.params.id))
      .limit(1);
    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }
    res.json({ success: true, data: song });
  } catch (err) {
    console.error('[songs/praise-night/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};
router.get('/praise-night/:id', requireAuth, getSongByIdHandler);

/** GET /songs/zone — list zone songs */
router.get('/zone', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    const songs = await db.select().from(zoneSongs)
      .where(zoneId ? eq(zoneSongs.zoneId, zoneId as string) : undefined);
    res.json({ success: true, count: songs.length, data: songs.map(mergeRawRow) });
  } catch (err) {
    console.error('[songs/zone]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/zone/:id — existing Supabase zone_songs */
router.get('/zone/:id', requireAuth, async (req, res) => {
  try {
    const [song] = await db.select().from(zoneSongs).where(eq(zoneSongs.id, req.params.id)).limit(1);
    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(song) });
  } catch (err) {
    console.error('[songs/zone/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/subgroup — list subgroup songs */
router.get('/subgroup', requireAuth, async (req, res) => {
  try {
    const { subGroupId, zoneId } = req.query;
    const songs = await db.select().from(subgroupSongs)
      .where(
        subGroupId ? sql`${subgroupSongs.rawData}->>'subGroupId' = ${subGroupId as string} OR ${subgroupSongs.rawData}->>'sub_group_id' = ${subGroupId as string}` :
        zoneId ? eq(subgroupSongs.zoneId, zoneId as string) :
        undefined
      );
    res.json({ success: true, count: songs.length, data: songs.map(mergeRawRow) });
  } catch (err) {
    console.error('[songs/subgroup]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/subgroup/:id — existing Supabase subgroup_songs */
router.get('/subgroup/:id', requireAuth, async (req, res) => {
  try {
    const [song] = await db
      .select()
      .from(subgroupSongs)
      .where(eq(subgroupSongs.id, req.params.id))
      .limit(1);
    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(song) });
  } catch (err) {
    console.error('[songs/subgroup/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/zone-praise-nights — list */
router.get('/zone-praise-nights', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    const rows = await db.select().from(zonePraiseNights)
      .where(zoneId ? sql`${zonePraiseNights.rawData}->>'zoneId' = ${zoneId as string} OR ${zonePraiseNights.rawData}->>'zone_id' = ${zoneId as string}` : undefined);
    res.json({ success: true, count: rows.length, data: rows.map(mergeRawRow) });
  } catch (err) {
    console.error('[songs/zone-praise-nights]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/zone-praise-nights/:id */
router.get('/zone-praise-nights/:id', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(zonePraiseNights)
      .where(eq(zonePraiseNights.id, req.params.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[songs/zone-praise-nights/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/subgroup-praise-nights — list */
router.get('/subgroup-praise-nights', requireAuth, async (req, res) => {
  try {
    const { subGroupId } = req.query;
    const rows = await db.select().from(subgroupPraiseNights)
      .where(subGroupId ? eq(subgroupPraiseNights.subGroupId, subGroupId as string) : undefined);
    res.json({ success: true, count: rows.length, data: rows.map(mergeRawRow) });
  } catch (err) {
    console.error('[songs/subgroup-praise-nights]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/subgroup-praise-nights/:id */
router.get('/subgroup-praise-nights/:id', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(subgroupPraiseNights)
      .where(eq(subgroupPraiseNights.id, req.params.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[songs/subgroup-praise-nights/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** GET /songs/history */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { songId } = req.query;
    if (!songId || typeof songId !== 'string') {
      res.status(400).json({ success: false, error: 'Missing songId' });
      return;
    }

    // Try finding the song in any of the song tables
    const tables = [songs, ministeredSongs, zoneSongs, subgroupSongs];
    for (const t of tables) {
      const [song] = await db.select().from(t).where(eq(t.id, songId)).limit(1);
      if (song) {
        let history = (song as any).rawData?.history || (song as any).raw_data?.history;
        if (typeof history === 'string') {
          try {
            history = JSON.parse(history);
          } catch {
            history = [];
          }
        }
        res.json({ success: true, data: Array.isArray(history) ? history : [] });
        return;
      }
    }
    
    // Not found
    res.json({ success: true, data: [] });
  } catch (err) {
    console.error('[songs/history]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// Helper for song creation
const createSongHandler = async (req: any, res: any) => {
  try {
    const body = req.body || {};
    const songId = body.id || `song_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const zoneId = body.zoneId || body.zone_id;
    const praiseNightId = body.praiseNightId || body.praise_night_id || body.programId || body.program_id;

    const isZoneSpecific = zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq') && zoneId !== 'ZONE001';

    const songRow = {
      id: songId,
      title: body.title || 'Untitled Song',
      key: body.key || null,
      tempo: body.tempo || null,
      lyrics: body.lyrics || null,
      writer: body.writer || null,
      category: body.category || null,
      audioFile: body.audioFile || body.audio_file || null,
      audioUrls: body.audioUrls || body.audio_urls || null,
      conductor: body.conductor || null,
      leadSinger: body.leadSinger || body.lead_singer || null,
      drummer: body.drummer || null,
      zoneId: zoneId || null,
      praiseNightId: praiseNightId || null,
      status: body.status || 'unheard',
      isActive: Boolean(body.isActive),
      categories: body.categories || (body.category ? [body.category] : []),
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
      rawData: { ...body, id: songId, zoneId, praiseNightId },
    };

    if (isZoneSpecific) {
      await db.insert(zoneSongs).values({
        id: songId,
        title: songRow.title,
        key: songRow.key,
        tempo: songRow.tempo,
        zoneId: songRow.zoneId,
        status: songRow.status,
        audioFile: songRow.audioFile,
        categories: songRow.categories,
        rawData: songRow.rawData,
      });
    }

    await db.insert(songs).values(songRow).onConflictDoUpdate({
      target: songs.id,
      set: songRow,
    });

    res.status(201).json({ success: true, message: 'Song created successfully', data: songRow });
  } catch (err) {
    console.error('[songs/create]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.post('/', requireAuth, createSongHandler);
router.post('/praise-night', requireAuth, createSongHandler);

// Helper for song update
const updateSongHandler = async (req: any, res: any) => {
  try {
    const songId = req.params.id;
    const body = req.body || {};

    const [existing] = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
    const [zExisting] = !existing ? await db.select().from(zoneSongs).where(eq(zoneSongs.id, songId)).limit(1) : [null];

    if (!existing && !zExisting) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }

    const prevRaw = (existing?.rawData || zExisting?.rawData || {}) as Record<string, unknown>;
    const updatedRaw = { ...prevRaw, ...body };

    const updateFields: Record<string, any> = {
      updatedAt: new Date(),
      rawData: updatedRaw,
    };

    if (body.title !== undefined) updateFields.title = body.title;
    if (body.key !== undefined) updateFields.key = body.key;
    if (body.tempo !== undefined) updateFields.tempo = body.tempo;
    if (body.lyrics !== undefined) updateFields.lyrics = body.lyrics;
    if (body.writer !== undefined) updateFields.writer = body.writer;
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.audioFile !== undefined || body.audio_file !== undefined) updateFields.audioFile = body.audioFile || body.audio_file;
    if (body.audioUrls !== undefined || body.audio_urls !== undefined) updateFields.audioUrls = body.audioUrls || body.audio_urls;
    if (body.conductor !== undefined) updateFields.conductor = body.conductor;
    if (body.leadSinger !== undefined || body.lead_singer !== undefined) updateFields.leadSinger = body.leadSinger || body.lead_singer;
    if (body.drummer !== undefined) updateFields.drummer = body.drummer;
    if (body.status !== undefined) updateFields.status = body.status;
    if (body.isActive !== undefined) updateFields.isActive = Boolean(body.isActive);
    if (body.categories !== undefined) updateFields.categories = body.categories;
    if (body.praiseNightId !== undefined) updateFields.praiseNightId = body.praiseNightId;
    if (body.zoneId !== undefined) updateFields.zoneId = body.zoneId;

    if (existing) {
      await db.update(songs).set(updateFields).where(eq(songs.id, songId));
    }
    if (zExisting) {
      await db.update(zoneSongs).set(updateFields).where(eq(zoneSongs.id, songId));
    }

    res.json({ success: true, message: 'Song updated successfully', data: { id: songId, ...updateFields } });
  } catch (err) {
    console.error('[songs/update]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id', requireAuth, updateSongHandler);
router.patch('/praise-night/:id', requireAuth, updateSongHandler);

// Toggle song status (heard / unheard)
const toggleStatusHandler = async (req: any, res: any) => {
  try {
    const songId = req.params.id;
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ success: false, error: 'Missing status parameter' });
      return;
    }

    await Promise.all([
      db.update(songs).set({ status, updatedAt: new Date() }).where(eq(songs.id, songId)),
      db.update(zoneSongs).set({ status }).where(eq(zoneSongs.id, songId)),
    ]);

    res.json({ success: true, message: `Song status updated to ${status}` });
  } catch (err) {
    console.error('[songs/:id/status]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id/status', requireAuth, toggleStatusHandler);
router.patch('/praise-night/:id/status', requireAuth, toggleStatusHandler);

// Toggle song active status
const toggleActiveHandler = async (req: any, res: any) => {
  try {
    const songId = req.params.id;
    const { isActive, praiseNightId } = req.body;

    // If activating a song, optionally deactivate other songs in the same program
    if (isActive && praiseNightId) {
      await db.update(songs)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(songs.praiseNightId, praiseNightId));
    }

    await db.update(songs)
      .set({ isActive: Boolean(isActive), updatedAt: new Date() })
      .where(eq(songs.id, songId));

    res.json({ success: true, message: `Song active state set to ${Boolean(isActive)}` });
  } catch (err) {
    console.error('[songs/:id/active]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id/active', requireAuth, toggleActiveHandler);
router.patch('/praise-night/:id/active', requireAuth, toggleActiveHandler);

// Delete song
const deleteSongHandler = async (req: any, res: any) => {
  try {
    const songId = req.params.id;

    await Promise.all([
      db.delete(songs).where(eq(songs.id, songId)),
      db.delete(zoneSongs).where(eq(zoneSongs.id, songId)),
      db.delete(subgroupSongs).where(eq(subgroupSongs.id, songId)),
    ]);

    res.json({ success: true, message: 'Song deleted successfully' });
  } catch (err) {
    console.error('[songs/delete]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.delete('/:id', requireAuth, deleteSongHandler);
router.delete('/praise-night/:id', requireAuth, deleteSongHandler);

// Master / Ministered Songs Write routes
router.post('/master', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const songId = body.id || `ms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const row = {
      id: songId,
      title: body.title || 'Untitled Song',
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
      categories: body.categories || [],
      customParts: body.customParts || body.custom_parts || [],
      publishedAt: new Date(),
      updatedAt: new Date(),
      sourceType: body.sourceType || 'manual',
      isHqOnly: Boolean(body.isHqOnly),
      rawData: { ...body, id: songId },
    };

    await db.insert(ministeredSongs).values(row);
    res.status(201).json({ success: true, message: 'Master song created', data: row });
  } catch (err) {
    console.error('[songs/master POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.patch('/master/:id', requireAuth, async (req, res) => {
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
    console.error('[songs/master PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.delete('/master/:id', requireAuth, async (req, res) => {
  try {
    const songId = req.params.id;
    await db.delete(ministeredSongs).where(eq(ministeredSongs.id, songId));
    res.json({ success: true, message: 'Master song deleted' });
  } catch (err) {
    console.error('[songs/master DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /songs/praise-night/:id/duplicate — Duplicate a song within or across programs
router.post('/praise-night/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const songId = req.params.id;
    const { targetProgramId, targetPraiseNightId, zoneId } = req.body || {};

    const [existing] = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }

    const newId = `song_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const prevRaw = (existing.rawData || {}) as Record<string, unknown>;
    const targetProg = targetProgramId || targetPraiseNightId || existing.praiseNightId;

    const duplicateRow = {
      ...existing,
      id: newId,
      title: `${existing.title} (Copy)`,
      praiseNightId: targetProg,
      zoneId: zoneId || existing.zoneId,
      status: 'unheard',
      createdAt: new Date().toISOString(),
      updatedAt: new Date(),
      rawData: {
        ...prevRaw,
        id: newId,
        title: `${existing.title} (Copy)`,
        praiseNightId: targetProg,
        status: 'unheard',
        createdAt: new Date().toISOString(),
      },
    };

    await db.insert(songs).values(duplicateRow);
    res.status(201).json({
      success: true,
      message: 'Song duplicated successfully',
      data: duplicateRow,
    });
  } catch (err) {
    console.error('[songs/praise-night/:id/duplicate]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// GET /songs/:id/lyrics — Get lyrics and synced LRC for a song
router.get('/:id/lyrics', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;

    let [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (!song) {
      const [mSong] = await db.select().from(ministeredSongs).where(eq(ministeredSongs.id, id)).limit(1);
      if (mSong) song = mSong as any;
    }
    if (!song) {
      const [zSong] = await db.select().from(zoneSongs).where(eq(zoneSongs.id, id)).limit(1);
      if (zSong) song = zSong as any;
    }

    if (!song) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }

    const merged = mergeRawRow(song);
    const rawData = (song.rawData as Record<string, any>) || {};

    const karaokeLrcText = rawData.karaokeLrcText || merged.karaokeLrcText || null;
    const syncedLyrics = rawData.syncedLyrics || merged.syncedLyrics || null;
    const lyrics = rawData.lyrics || song.lyrics || merged.lyrics || null;

    res.json({
      success: true,
      data: {
        id,
        karaokeLrcText,
        syncedLyrics,
        lyricsText: lyrics,
        hasSyncedLyrics: Boolean(rawData.hasSyncedLyrics || karaokeLrcText || (syncedLyrics && syncedLyrics.length > 0)),
      },
    });
  } catch (err) {
    console.error('[songs/:id/lyrics:GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch lyrics' });
  }
});

// PATCH /songs/:id/lyrics — Save synced LRC or plain lyrics for a song
router.patch('/:id/lyrics', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { karaokeLrcText, syncedLyrics, lyrics } = req.body || {};
    const now = new Date().toISOString();

    let updated = false;

    // 1. Try songs table
    const [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song) {
      const rawData = (song.rawData as Record<string, any>) || {};
      const updatedRaw = {
        ...rawData,
        ...(karaokeLrcText !== undefined ? { karaokeLrcText } : {}),
        ...(syncedLyrics !== undefined ? { syncedLyrics } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
        hasSyncedLyrics: Boolean(karaokeLrcText || (syncedLyrics && syncedLyrics.length > 0)),
        lyricsUpdatedAt: now,
      };

      const setFields: any = { rawData: updatedRaw };
      if (lyrics !== undefined) setFields.lyrics = lyrics;

      await db.update(songs).set(setFields).where(eq(songs.id, id));
      updated = true;
    }

    // 2. Try ministeredSongs table
    const [mSong] = await db.select().from(ministeredSongs).where(eq(ministeredSongs.id, id)).limit(1);
    if (mSong) {
      const rawData = (mSong.rawData as Record<string, any>) || {};
      const updatedRaw = {
        ...rawData,
        ...(karaokeLrcText !== undefined ? { karaokeLrcText } : {}),
        ...(syncedLyrics !== undefined ? { syncedLyrics } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
        hasSyncedLyrics: Boolean(karaokeLrcText || (syncedLyrics && syncedLyrics.length > 0)),
        lyricsUpdatedAt: now,
      };

      const setFields: any = { rawData: updatedRaw };
      if (lyrics !== undefined) setFields.lyrics = lyrics;

      await db.update(ministeredSongs).set(setFields).where(eq(ministeredSongs.id, id));
      updated = true;
    }

    // 3. Try zoneSongs table
    const [zSong] = await db.select().from(zoneSongs).where(eq(zoneSongs.id, id)).limit(1);
    if (zSong) {
      const rawData = (zSong.rawData as Record<string, any>) || {};
      const updatedRaw = {
        ...rawData,
        ...(karaokeLrcText !== undefined ? { karaokeLrcText } : {}),
        ...(syncedLyrics !== undefined ? { syncedLyrics } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
        hasSyncedLyrics: Boolean(karaokeLrcText || (syncedLyrics && syncedLyrics.length > 0)),
        lyricsUpdatedAt: now,
      };

      await db.update(zoneSongs).set({ rawData: updatedRaw }).where(eq(zoneSongs.id, id));
      updated = true;
    }

    if (!updated) {
      res.status(404).json({ success: false, error: 'Song not found' });
      return;
    }

    res.json({
      success: true,
      message: 'Lyrics saved successfully',
      data: { id, karaokeLrcText, syncedLyrics, lyrics },
    });
  } catch (err) {
    console.error('[songs/:id/lyrics:PATCH]', err);
    res.status(500).json({ success: false, error: 'Failed to save lyrics' });
  }
});

// GET /songs/:id — Single song lookup across all song tables
router.get('/:id', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song) {
      res.json({ success: true, data: mergeRawRow(song) });
      return;
    }

    const [mSong] = await db.select().from(ministeredSongs).where(eq(ministeredSongs.id, id)).limit(1);
    if (mSong) {
      res.json({ success: true, data: mergeRawRow(mSong) });
      return;
    }

    const [zSong] = await db.select().from(zoneSongs).where(eq(zoneSongs.id, id)).limit(1);
    if (zSong) {
      res.json({ success: true, data: mergeRawRow(zSong) });
      return;
    }

    res.status(404).json({ success: false, error: 'Song not found' });
  } catch (err) {
    console.error('[songs/:id:GET]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;


