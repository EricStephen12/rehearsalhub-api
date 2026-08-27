import { Router } from 'express';
import { eq, or, asc, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  ministeredSongs,
  songs,
  zoneSongs,
  subgroupSongs,
  zonePraiseNights,
  subgroupPraiseNights,
  programs,
  zonePrograms,
  songHistory,
  userSongNotes,
  mediaDoodles,
} from '../schema';
import { requireAuth, requireTenantAdmin } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';
import { broadcast } from '../ws/wsServer';

const router = Router();

// GET /songs/master & /songs/ministered — ministered songs library
const getMinisteredSongsHandler = async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(ministeredSongs).orderBy(asc(ministeredSongs.title));
    const merged = rows.map((r) => {
      const m = mergeRawRow(r);
      const raw = (r.rawData && typeof r.rawData === 'object') ? (r.rawData as Record<string, any>) : {};
      const audioFile = r.audioFile || raw.audioFile || raw.audioUrl || (m.audioFile as string) || '';
      return {
        ...m,
        id: r.id,
        title: r.title || raw.title || 'Untitled Song',
        audioFile,
        audioUrl: audioFile,
        audioUrls: r.audioUrls || raw.audioUrls || m.audioUrls || { full: audioFile },
        lyrics: r.lyrics || raw.lyrics || m.lyrics || '',
        solfa: r.solfa || raw.solfas || raw.solfa || m.solfa || '',
        leadSinger: (r as any).leadSinger || raw.leadSinger || raw.lead_singer || m.leadSinger || 'Loveworld Singers',
        writer: (r as any).writer || raw.writer || m.writer || '',
        category: r.category || raw.category || m.category || 'Praise Night',
        key: r.key || raw.key || m.key || '',
        tempo: r.tempo || raw.tempo || m.tempo || '',
        conductorGuide: raw.conductorGuide || raw.conductor_guide || '',
      };
    });
    res.json({ success: true, count: merged.length, data: merged });
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
    const m = mergeRawRow(song);
    const raw = (song.rawData && typeof song.rawData === 'object') ? (song.rawData as Record<string, any>) : {};
    const audioFile = song.audioFile || raw.audioFile || raw.audioUrl || (m.audioFile as string) || '';
    res.json({
      success: true,
      data: {
        ...m,
        id: song.id,
        title: song.title || raw.title || 'Untitled Song',
        audioFile,
        audioUrl: audioFile,
        audioUrls: song.audioUrls || raw.audioUrls || m.audioUrls || { full: audioFile },
        lyrics: song.lyrics || raw.lyrics || m.lyrics || '',
        solfa: song.solfa || raw.solfas || raw.solfa || m.solfa || '',
        leadSinger: (song as any).leadSinger || raw.leadSinger || raw.lead_singer || m.leadSinger || 'Loveworld Singers',
        writer: (song as any).writer || raw.writer || m.writer || '',
        category: song.category || raw.category || m.category || 'Praise Night',
        key: song.key || raw.key || m.key || '',
        tempo: song.tempo || raw.tempo || m.tempo || '',
        conductorGuide: raw.conductorGuide || raw.conductor_guide || '',
      },
    });
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
    if (targetProgramId) {
      const [mainRows, zRows] = await Promise.all([
        db.select().from(songs).where(
          sql`${songs.praiseNightId} = ${targetProgramId} OR ${songs.rawData}->>'praiseNightId' = ${targetProgramId} OR ${songs.rawData}->>'programId' = ${targetProgramId} OR lower(${songs.rawData}->>'praise_night_id') = ${targetProgramId.toLowerCase()}`
        ),
        db.select().from(zoneSongs).where(
          sql`${zoneSongs.rawData}->>'praiseNightId' = ${targetProgramId} OR ${zoneSongs.rawData}->>'programId' = ${targetProgramId} OR lower(${zoneSongs.rawData}->>'praise_night_id') = ${targetProgramId.toLowerCase()}`
        ),
      ]);
      const mergedZ = zRows.map(mergeRawRow);
      rows = [...mainRows, ...mergedZ].sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''))
      );

      // Fallback: check if the program itself has embedded songs
      if (rows.length === 0) {
        const [prog] = await db.select().from(programs).where(eq(programs.id, targetProgramId)).limit(1);
        const [zProg] = !prog ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, targetProgramId)).limit(1) : [null];
        const p = prog || zProg;
        if (p) {
          const raw = mergeRawRow(p);
          if (Array.isArray(raw.songs) && raw.songs.length > 0) {
            rows = raw.songs;
          }
        }
      }
    } else if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      const cleanZone = (zoneId as string).toLowerCase().trim();
      const withoutHyphen = cleanZone.replace(/[\s-_]/g, '');
      const withHyphen = cleanZone.includes('-') ? cleanZone : cleanZone.replace(/^zone(\d+)$/, 'zone-$1');

      // Find programs belonging to this zone to extract embedded songs & program IDs
      const [zProgs, progs] = await Promise.all([
        db.select().from(zonePrograms).where(
          sql`lower(replace(replace(${zonePrograms.zoneId}, '-', ''), ' ', '')) = ${withoutHyphen} OR lower(${zonePrograms.zoneId}) = ${cleanZone} OR lower(${zonePrograms.zoneId}) = ${withHyphen} OR lower(replace(replace(${zonePrograms.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${zonePrograms.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphen}`
        ),
        db.select().from(programs).where(
          sql`lower(replace(replace(${programs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphen} OR lower(${programs.zoneId}) = ${cleanZone} OR lower(${programs.zoneId}) = ${withHyphen} OR lower(replace(replace(${programs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${programs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphen}`
        ),
      ]);

      const embeddedSongs: any[] = [];
      [...zProgs, ...progs].forEach((p: any) => {
        const merged = mergeRawRow(p);
        if (Array.isArray(merged.songs)) {
          merged.songs.forEach((s: any) => embeddedSongs.push(s));
        }
      });

      const [mainRows, zRows] = await Promise.all([
        db.select().from(songs).where(
          sql`lower(replace(replace(${songs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphen} OR lower(${songs.zoneId}) = ${cleanZone} OR lower(${songs.zoneId}) = ${withHyphen} OR lower(replace(replace(${songs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${songs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${songs.rawData}->>'zone_id', '-', ''), ' ', '')) = ${withoutHyphen}`
        ),
        db.select().from(zoneSongs).where(
          sql`lower(replace(replace(${zoneSongs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphen} OR lower(${zoneSongs.zoneId}) = ${cleanZone} OR lower(${zoneSongs.zoneId}) = ${withHyphen} OR lower(replace(replace(${zoneSongs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${zoneSongs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphen} OR lower(replace(replace(${zoneSongs.rawData}->>'zone_id', '-', ''), ' ', '')) = ${withoutHyphen}`
        ),
      ]);

      const allMerged = [...mainRows, ...zRows.map(mergeRawRow), ...embeddedSongs];
      const seen = new Set<string>();
      rows = allMerged.filter((s: any) => {
        const key = String(s.id || s.title || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) =>
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

/** GET /songs/notes/:songId — load the authenticated user's personal note for a song */
router.get('/notes/:songId', requireAuth, async (req: any, res: any) => {
  try {
    const { songId } = req.params;
    const userId = res.locals.auth?.userId;
    if (!userId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    const rows = await db.select().from(userSongNotes).where(eq(userSongNotes.songId, songId));
    const own = rows.find((r: any) => r.userId === userId);
    if (own) {
      res.json({ success: true, data: { notes: own.notes, id: own.id } });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (err) {
    console.error('[songs/notes/:songId:GET]', err);
    res.status(500).json({ success: false, error: 'Failed to load notes' });
  }
});

/** GET /songs/annotations/:songId — load all annotations (doodles) for a song */
router.get('/annotations/:songId', requireAuth, async (req: any, res: any) => {
  try {
    const { songId } = req.params;
    const rows = await db.select().from(mediaDoodles).where(eq(mediaDoodles.songId, songId));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[songs/annotations/:songId:GET]', err);
    res.status(500).json({ success: false, error: 'Failed to load annotations' });
  }
});

/** GET /songs/history */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { songId, title } = req.query as { songId?: string; title?: string };
    if (!songId && !title) {
      res.status(400).json({ success: false, error: 'Missing songId or title' });
      return;
    }

    const sid = typeof songId === 'string' ? songId.trim() : '';
    const stitle = typeof title === 'string' ? title.trim() : '';

    // 1. Fetch from song_history table
    const whereConditions = [];
    if (sid) {
      whereConditions.push(
        sql`${songHistory.songId} = ${sid} OR ${songHistory.rawData}->>'songId' = ${sid} OR ${songHistory.rawData}->>'song_id' = ${sid} OR ${songHistory.rawData}->>'firebaseId' = ${sid}`
      );
    }
    if (stitle) {
      whereConditions.push(
        sql`lower(${songHistory.title}) = lower(${stitle}) OR lower(${songHistory.rawData}->>'title') = lower(${stitle}) OR lower(${songHistory.rawData}->>'songTitle') = lower(${stitle})`
      );
    }

    const rows = await db
      .select()
      .from(songHistory)
      .where(or(...whereConditions))
      .orderBy(desc(songHistory.createdAt));

    const merged = rows.map(mergeRawRow);

    // 2. Also check if the song has an embedded history array in rawData across songs or programs
    if (merged.length === 0) {
      const tables = [songs, ministeredSongs, zoneSongs, subgroupSongs];
      for (const t of tables) {
        if (sid) {
          const [song] = await db.select().from(t).where(eq(t.id, sid)).limit(1);
          if (song) {
            let history = (song as any).rawData?.history || (song as any).raw_data?.history;
            if (typeof history === 'string') {
              try {
                history = JSON.parse(history);
              } catch {
                history = [];
              }
            }
            if (Array.isArray(history) && history.length > 0) {
              res.json({ success: true, count: history.length, data: history });
              return;
            }
          }
        }
      }

      // Check programs (praise nights) for embedded song history
      const progRows = await db.select().from(programs);
      for (const prog of progRows) {
        const progSongs = Array.isArray(prog.songs) ? prog.songs : (prog.rawData as any)?.songs;
        if (Array.isArray(progSongs)) {
          const found = progSongs.find((s: any) =>
            (sid && (s.id === sid || s.firebaseId === sid || String(s.songId) === sid)) ||
            (stitle && s.title && s.title.toLowerCase().trim() === stitle.toLowerCase().trim())
          );
          if (found && Array.isArray(found.history) && found.history.length > 0) {
            res.json({ success: true, count: found.history.length, data: found.history });
            return;
          }
        }
      }
    }

    res.json({ success: true, count: merged.length, data: merged });
  } catch (err) {
    console.error('[songs/history]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** POST /songs/history */
router.post('/history', requireAuth, async (req: any, res: any) => {
  try {
    const body = req.body || {};
    const { songId, type, title, new_value, old_value, description } = body;
    if (!songId) {
      res.status(400).json({ success: false, error: 'Missing songId' });
      return;
    }

    const id = body.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const createdBy = body.created_by || req.user?.displayName || req.user?.email || 'Admin';
    const now = new Date();

    const row = {
      id,
      songId,
      type: type || 'metadata',
      title: title || 'Song Update',
      newValue: typeof new_value === 'object' ? JSON.stringify(new_value) : String(new_value || ''),
      oldValue: typeof old_value === 'object' ? JSON.stringify(old_value) : String(old_value || ''),
      description: description || 'Song changes updated',
      createdBy,
      createdAt: now,
      rawData: {
        ...body,
        id,
        songId,
        type,
        title,
        new_value,
        old_value,
        description,
        created_by: createdBy,
        created_at: now.toISOString(),
      },
    };

    await db.insert(songHistory).values(row);
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[songs/history POST]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

/** DELETE /songs/history/:id */
router.delete('/history/:id', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, error: 'Missing history id' });
      return;
    }
    await db.delete(songHistory).where(eq(songHistory.id, id));
    res.json({ success: true, message: 'History entry deleted' });
  } catch (err) {
    console.error('[songs/history DELETE]', err);
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
        category: body.category || '',
        rawData: songRow.rawData,
      });
    }

    await db.insert(songs).values(songRow).onConflictDoUpdate({
      target: songs.id,
      set: songRow,
    });

    const mergedCreated = mergeRawRow(songRow);
    broadcast('song', songId, mergedCreated);
    broadcast('song', 'all', mergedCreated);
    if (praiseNightId) {
      broadcast('songs', praiseNightId, mergedCreated);
    }

    res.status(201).json({ success: true, message: 'Song created successfully', data: songRow });
  } catch (err) {
    console.error('[songs/create]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.post('/', requireAuth, requireTenantAdmin, createSongHandler);
router.post('/praise-night', requireAuth, requireTenantAdmin, createSongHandler);

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

    const mergedSong = mergeRawRow({ ...(existing || zExisting), ...updateFields, rawData: updatedRaw });
    broadcast('song', songId, mergedSong);
    broadcast('song', 'all', mergedSong);
    const pId = updateFields.praiseNightId || existing?.praiseNightId || (zExisting?.rawData as any)?.praiseNightId;
    if (pId) {
      broadcast('songs', String(pId), mergedSong);
    }

    res.json({ success: true, message: 'Song updated successfully', data: { id: songId, ...updateFields, ...mergedSong } });
  } catch (err) {
    console.error('[songs/update]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id', requireAuth, requireTenantAdmin, updateSongHandler);
router.patch('/praise-night/:id', requireAuth, requireTenantAdmin, updateSongHandler);

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

    broadcast('song', songId, { id: songId, status });
    broadcast('song', 'all', { id: songId, status });

    res.json({ success: true, message: `Song status updated to ${status}` });
  } catch (err) {
    console.error('[songs/:id/status]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id/status', requireAuth, requireTenantAdmin, toggleStatusHandler);
router.patch('/praise-night/:id/status', requireAuth, requireTenantAdmin, toggleStatusHandler);

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

    broadcast('song', songId, { id: songId, isActive: Boolean(isActive) });
    broadcast('song', 'all', { id: songId, isActive: Boolean(isActive) });

    res.json({ success: true, message: `Song active state set to ${Boolean(isActive)}` });
  } catch (err) {
    console.error('[songs/:id/active]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.patch('/:id/active', requireAuth, requireTenantAdmin, toggleActiveHandler);
router.patch('/praise-night/:id/active', requireAuth, requireTenantAdmin, toggleActiveHandler);

// Delete song
const deleteSongHandler = async (req: any, res: any) => {
  try {
    const songId = req.params.id;

    await Promise.all([
      db.delete(songs).where(eq(songs.id, songId)),
      db.delete(zoneSongs).where(eq(zoneSongs.id, songId)),
      db.delete(subgroupSongs).where(eq(subgroupSongs.id, songId)),
    ]);

    broadcast('song', songId, { id: songId, deleted: true });
    broadcast('song', 'all', { id: songId, deleted: true });

    res.json({ success: true, message: 'Song deleted successfully' });
  } catch (err) {
    console.error('[songs/delete]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
};

router.delete('/:id', requireAuth, requireTenantAdmin, deleteSongHandler);
router.delete('/praise-night/:id', requireAuth, requireTenantAdmin, deleteSongHandler);

// Master / Ministered Songs Write routes
router.post('/master', requireAuth, requireTenantAdmin, async (req, res) => {
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

router.patch('/master/:id', requireAuth, requireTenantAdmin, async (req, res) => {
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

router.delete('/master/:id', requireAuth, requireTenantAdmin, async (req, res) => {
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
router.post('/praise-night/:id/duplicate', requireAuth, requireTenantAdmin, async (req, res) => {
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

    const lyricsData = { id, karaokeLrcText, syncedLyrics, lyrics };
    broadcast('song', id, lyricsData);
    broadcast('song', 'all', lyricsData);

    res.json({
      success: true,
      message: 'Lyrics saved successfully',
      data: lyricsData,
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

// POST /songs/import-from-ministered — Import songs from ministered songs into repertoire
router.post('/import-from-ministered', requireAuth, requireTenantAdmin, async (req: any, res: any) => {
  try {
    const auth = res.locals.auth;
    const { songIds, praiseNightId } = req.body;
    if (!Array.isArray(songIds) || songIds.length === 0) {
      res.status(400).json({ success: false, error: 'songIds array is required' });
      return;
    }

    const ministeredList = await db
      .select()
      .from(ministeredSongs)
      .where(inArray(ministeredSongs.id, songIds));

    const isHq = auth.role === 'hq_admin' || auth.isHq;
    const zoneId = auth.effectiveZoneId || auth.zoneId || 'hq';

    let importedCount = 0;
    for (const m of ministeredList) {
      const newId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const raw = (m.rawData && typeof m.rawData === 'object') ? { ...(m.rawData as any) } : {};
      raw.importedFromMinisteredId = m.id;
      raw.leadSinger = m.leadSinger || raw.leadSinger;
      const mRaw = (m.rawData && typeof m.rawData === 'object') ? (m.rawData as any) : {};
      const conductorGuide = mRaw.conductorGuide || mRaw.conductor_guide || mRaw.solfas || '';
      const history = mRaw.history || '';
      const praiseId = praiseNightId || mRaw.praiseNightId || mRaw.programId || null;

      raw.importedFromMinisteredId = m.id;
      raw.leadSinger = mRaw.leadSinger || raw.leadSinger || '';
      raw.writer = m.writer || raw.writer || '';
      raw.category = m.category || raw.category || 'Praise Night';
      raw.key = m.key || raw.key || '';
      raw.tempo = m.tempo || raw.tempo || '';
      raw.conductorGuide = conductorGuide;
      raw.history = history;
      raw.lyrics = m.lyrics || raw.lyrics || '';
      raw.audioUrls = m.audioUrls || raw.audioUrls || {};
      raw.audioFile = m.audioFile || raw.audioFile || '';
      raw.audioUrl = m.audioFile || raw.audioUrl || '';

      if (isHq) {
        await db.insert(songs).values({
          id: newId,
          title: m.title || 'Untitled Song',
          writer: m.writer || '',
          category: m.category || 'Praise Night',
          key: m.key || '',
          tempo: m.tempo || '',
          lyrics: m.lyrics || '',
          audioFile: m.audioFile || '',
          audioUrls: m.audioUrls || {},
          praiseNightId: praiseId,
          zoneId: 'hq',
          rawData: raw,
        });
      } else {
        await db.insert(zoneSongs).values({
          id: newId,
          title: m.title || 'Untitled Song',
          category: m.category || 'Praise Night',
          key: m.key || '',
          tempo: m.tempo || '',
          audioFile: m.audioFile || '',
          zoneId,
          rawData: raw,
        });
      }
      importedCount++;
    }

    res.json({
      success: true,
      count: importedCount,
      message: `Successfully imported ${importedCount} song(s) into repertoire.`,
    });
  } catch (err) {
    console.error('[songs/import-from-ministered]', err);
    res.status(500).json({ success: false, error: 'Failed to import songs' });
  }
});

export default router;


