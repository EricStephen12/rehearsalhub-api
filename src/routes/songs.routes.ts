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

export default router;
