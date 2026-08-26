import { Router } from 'express';
import { eq, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { programs, zonePrograms, songs } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

// GET /programs or /praise-nights
// HQ admins see all programs. Zone admins/members auto-scope to their zone via JWT.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { zoneId: queryZoneId, category } = req.query as { zoneId?: string; category?: string };
    const auth = res.locals.auth;

    // HQ admins see everything; everyone else scopes to their zone
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = req.tenant?.effectiveZoneId !== undefined
      ? req.tenant.effectiveZoneId
      : (queryZoneId || (!isHqAdmin ? (auth.zoneId as string | null) : null));

    const HQ_GROUP_IDS = new Set([
      'zone-001', 'zone-002', 'zone-003', 'zone-004', 'zone-005',
      'loveworld-singers-hq', 'zone001', 'zone002', 'zone003', 'zone004', 'zone005',
      'hq'
    ]);

    let rows: any[] = [];

    if (effectiveZoneId) {
      const cleanZone = effectiveZoneId.toLowerCase().trim();
      const withoutHyphen = cleanZone.replace(/-/g, '');
      const withHyphen = cleanZone.includes('-') ? cleanZone : cleanZone.replace(/^zone(\d+)$/, 'zone-$1');

      const isHqGroup = 
        HQ_GROUP_IDS.has(cleanZone) || 
        HQ_GROUP_IDS.has(withoutHyphen) ||
        HQ_GROUP_IDS.has(withHyphen) ||
        cleanZone === 'hq' || 
        cleanZone === 'loveworld-singers-hq';

      if (isHqGroup || effectiveZoneId === 'all') {
        // HQ Big Zone: gets all HQ programs + specific HQ sub-group sessions (does not leak other external zones)
        const [hqProgs, zRows] = await Promise.all([
          db.select().from(programs),
          db.select().from(zonePrograms).where(
            sql`lower(replace(${zonePrograms.zoneId}, '-', '')) = ${withoutHyphen} OR lower(${zonePrograms.zoneId}) = ${withHyphen} OR lower(replace(${zonePrograms.rawData}->>'zone_code', '-', '')) = ${withoutHyphen} OR lower(replace(${zonePrograms.rawData}->>'zoneId', '-', '')) = ${withoutHyphen}`
          ),
        ]);
        const mergedZ = zRows.map(mergeRawRow);
        const mergedHq = hqProgs.map(mergeRawRow);
        rows = [...mergedZ, ...mergedHq];
      } else {
        // External Zone (e.g. zone-sa-1, zone-017, zone-052): gets ONLY their own zone's programs
        const [zRows, zoneSpecificRows] = await Promise.all([
          db.select().from(zonePrograms).where(
            sql`lower(replace(${zonePrograms.zoneId}, '-', '')) = ${withoutHyphen} OR lower(${zonePrograms.zoneId}) = ${withHyphen} OR lower(replace(${zonePrograms.rawData}->>'zone_code', '-', '')) = ${withoutHyphen} OR lower(replace(${zonePrograms.rawData}->>'zoneId', '-', '')) = ${withoutHyphen}`
          ),
          db.select().from(programs).where(
            sql`lower(replace(${programs.zoneId}, '-', '')) = ${withoutHyphen} OR lower(${programs.zoneId}) = ${withHyphen} OR lower(replace(${programs.rawData}->>'zone_code', '-', '')) = ${withoutHyphen} OR lower(replace(${programs.rawData}->>'zoneId', '-', '')) = ${withoutHyphen}`
          ),
        ]);
        const mergedZ = zRows.map(mergeRawRow);
        const mergedZoneSpecific = zoneSpecificRows.map(mergeRawRow);
        rows = [...mergedZ, ...mergedZoneSpecific];
      }
    } else {
      const allGlobal = await db.select().from(programs);
      rows = allGlobal.map(mergeRawRow);
    }

function getProgramTimestamp(p: any): number {
  const raw = (p.rawData && typeof p.rawData === 'object' ? p.rawData : {}) as any;
  if (raw?.createdAt?._seconds) return Number(raw.createdAt._seconds) * 1000;
  if (raw?.createdAt?.seconds) return Number(raw.createdAt.seconds) * 1000;
  if (p.createdAt) {
    const t = new Date(p.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (p.date) {
    const t = new Date(p.date).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return 0;
}

    // Fetch real song counts from the songs table grouped by praiseNightId
    let songCountMap = new Map<string, number>();
    try {
      const songCountRows = await db
        .select({
          praiseNightId: songs.praiseNightId,
          count: sql<number>`count(*)::int`,
        })
        .from(songs)
        .groupBy(songs.praiseNightId);
      for (const sc of songCountRows) {
        if (sc.praiseNightId) {
          songCountMap.set(sc.praiseNightId, Number(sc.count));
        }
      }
    } catch (e) {
      console.warn('[programs] Failed to query song counts:', e);
    }

    let data = rows.map((p) => {
      const dbCount = songCountMap.get(p.id) || 0;
      const raw = (p.rawData && typeof p.rawData === 'object' ? p.rawData : {}) as any;
      const arrayCount = Array.isArray(p.songs) ? p.songs.length :
                         Array.isArray(raw.songs) ? raw.songs.length :
                         Array.isArray(p.songIds) ? p.songIds.length :
                         Array.isArray(raw.songIds) ? raw.songIds.length :
                         Array.isArray(p.song_ids) ? p.song_ids.length :
                         Array.isArray(raw.song_ids) ? raw.song_ids.length : 0;
      const effectiveCount = Math.max(dbCount, arrayCount, Number(p.songCount || raw.songCount || p.song_count || raw.song_count || 0));
      return {
        ...p,
        songCount: effectiveCount,
        song_count: effectiveCount,
      };
    }).sort((a, b) => {
      if (a.category === 'ongoing' && b.category !== 'ongoing') return -1;
      if (a.category !== 'ongoing' && b.category === 'ongoing') return 1;
      return getProgramTimestamp(b) - getProgramTimestamp(a);
    });

    if (category && category !== 'all') {
      const target = category.toLowerCase().trim();
      data = data.filter((p: any) => {
        const cat = (p.category || '').toLowerCase().trim();
        return cat === target;
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('[programs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// GET /programs/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(programs)
      .where(eq(programs.id, req.params.id))
      .limit(1);
    if (!row) {
      // Try zone_programs
      const [zRow] = await db
        .select()
        .from(zonePrograms)
        .where(eq(zonePrograms.id, req.params.id))
        .limit(1);
      if (!zRow) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
      res.json({ success: true, data: mergeRawRow(zRow) });
      return;
    }
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[programs/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// GET /programs/zone/all or /praise-nights/zone/all
router.get('/zone/all', requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query as { zoneId?: string };
    
    let query = db.select().from(zonePrograms);
    const rows = await query;
    const data = rows
      .map(mergeRawRow)
      .filter((r: any) => !zoneId || r.zoneId === zoneId || r.zone_id === zoneId)
      .sort((a: any, b: any) => {
        const ac = String(a.createdAt ?? a.date ?? '');
        const bc = String(b.createdAt ?? b.date ?? '');
        return bc.localeCompare(ac);
      });
      
    res.json({ success: true, data });
  } catch (err) {
    console.error('[programs/zone/all]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /programs or /praise-nights — Create program
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, date, zoneId, scope, category, status, location, bannerImage, songs, songIds } = req.body;
    const programId = req.body.id || `prog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveCategory = category || (status === 'ongoing' ? 'ongoing' : status === 'archive' ? 'archive' : 'pre-rehearsal');
    const effectiveStatus = status || effectiveCategory;
    const isZoneSpecific = zoneId && zoneId !== 'zone-001' && !zoneId.toLowerCase().includes('hq') && zoneId !== 'ZONE001';

    if (isZoneSpecific) {
      await db.insert(zonePrograms).values({
        id: programId,
        name: name || 'Rehearsal Program',
        date: date || new Date().toISOString(),
        zoneId,
        category: effectiveCategory,
        status: effectiveStatus,
        isActive: effectiveStatus === 'ongoing',
        isArchived: effectiveStatus === 'archive',
        location: location || null,
        bannerImage: bannerImage || null,
        songs: songs || [],
        songIds: songIds || (Array.isArray(songs) ? songs.map((s: any) => s.id || s) : []),
        createdAt: new Date(),
        updatedAt: new Date(),
        rawData: req.body,
      });
    } else {
      await db.insert(programs).values({
        id: programId,
        name: name || 'Praise Night / Program',
        date: date || new Date().toISOString(),
        scope: scope || 'hq',
        zoneId: zoneId || 'zone-001',
        category: effectiveCategory,
        status: effectiveStatus,
        isActive: effectiveStatus === 'ongoing',
        isArchived: effectiveStatus === 'archive',
        location: location || null,
        bannerImage: bannerImage || null,
        songs: songs || [],
        songIds: songIds || (Array.isArray(songs) ? songs.map((s: any) => s.id || s) : []),
        createdAt: new Date(),
        updatedAt: new Date(),
        rawData: req.body,
      });
    }

    res.json({ success: true, message: 'Program created successfully', data: { id: programId } });
  } catch (err) {
    console.error('[programs/create]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /programs/:id/status — Toggle program status (ongoing, pre-rehearsal, archive, draft)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ success: false, error: 'Missing status' });
      return;
    }
    const isOngoing = status === 'ongoing';
    const isArchive = status === 'archive' || status === 'archived';

    await Promise.all([
      db.update(programs)
        .set({
          status,
          category: isOngoing ? 'ongoing' : isArchive ? 'archive' : 'pre-rehearsal',
          isActive: isOngoing,
          isArchived: isArchive,
          updatedAt: new Date(),
        })
        .where(eq(programs.id, req.params.id)),
      db.update(zonePrograms)
        .set({
          status,
          category: isOngoing ? 'ongoing' : isArchive ? 'archive' : 'pre-rehearsal',
          isActive: isOngoing,
          isArchived: isArchive,
          updatedAt: new Date(),
        })
        .where(eq(zonePrograms.id, req.params.id)),
    ]);

    res.json({ success: true, message: `Program status updated to ${status}` });
  } catch (err) {
    console.error('[programs/:id/status]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /programs/:id/duplicate — Duplicate a program & its song list within a zone
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const sourceId = req.params.id;
    const { newName, newDate, targetZoneId } = req.body;

    // Find source program
    const [prog] = await db.select().from(programs).where(eq(programs.id, sourceId)).limit(1);
    const [zProg] = !prog ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, sourceId)).limit(1) : [null];
    const source = prog || zProg;

    if (!source) {
      res.status(404).json({ success: false, error: 'Source program not found' });
      return;
    }

    const newId = `prog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveZoneId = targetZoneId || source.zoneId || 'zone-001';
    const isZoneSpecific = effectiveZoneId && effectiveZoneId !== 'zone-001' && !effectiveZoneId.toLowerCase().includes('hq');

    const duplicateData = {
      id: newId,
      name: newName || `${source.name} (Copy)`,
      date: newDate || new Date().toISOString(),
      zoneId: effectiveZoneId,
      category: 'pre-rehearsal',
      status: 'pre-rehearsal',
      isActive: false,
      isArchived: false,
      location: source.location || null,
      bannerImage: source.bannerImage || null,
      songs: source.songs || [],
      songIds: source.songIds || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      rawData: { ...(source.rawData as Record<string, unknown> || {}), isCloned: true, clonedFromId: sourceId },
    };

    if (isZoneSpecific) {
      await db.insert(zonePrograms).values(duplicateData);
    } else {
      await db.insert(programs).values({ ...duplicateData, scope: (source as any).scope || 'hq' });
    }

    res.json({
      success: true,
      message: 'Program duplicated successfully',
      data: { id: newId, name: duplicateData.name, songCount: Array.isArray(duplicateData.songs) ? duplicateData.songs.length : 0 },
    });
  } catch (err) {
    console.error('[programs/:id/duplicate]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /programs/:id/import-songs — Import/append songs from another program into this program
router.post('/:id/import-songs', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const { sourceProgramId, songIds: specificSongIds } = req.body;

    if (!sourceProgramId) {
      res.status(400).json({ success: false, error: 'Missing sourceProgramId' });
      return;
    }

    // Get source program
    const [sProg] = await db.select().from(programs).where(eq(programs.id, sourceProgramId)).limit(1);
    const [sZProg] = !sProg ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, sourceProgramId)).limit(1) : [null];
    const source = sProg || sZProg;

    if (!source) {
      res.status(404).json({ success: false, error: 'Source program not found' });
      return;
    }

    // Get target program
    const [tProg] = await db.select().from(programs).where(eq(programs.id, targetId)).limit(1);
    const [tZProg] = !tProg ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, targetId)).limit(1) : [null];
    const target = tProg || tZProg;

    if (!target) {
      res.status(404).json({ success: false, error: 'Target program not found' });
      return;
    }

    const sourceSongs: any[] = Array.isArray(source.songs) ? source.songs : [];
    const targetSongs: any[] = Array.isArray(target.songs) ? target.songs : [];

    const songsToImport = specificSongIds && Array.isArray(specificSongIds)
      ? sourceSongs.filter((s: any) => specificSongIds.includes(s.id || s))
      : sourceSongs;

    const existingIds = new Set(targetSongs.map((s: any) => s.id || s));
    const newSongs = [...targetSongs];

    for (const song of songsToImport) {
      const sId = song.id || song;
      if (!existingIds.has(sId)) {
        newSongs.push(song);
        existingIds.add(sId);
      }
    }

    const newSongIds = Array.from(existingIds);

    if (tProg) {
      await db.update(programs).set({ songs: newSongs, songIds: newSongIds, updatedAt: new Date() }).where(eq(programs.id, targetId));
    } else {
      await db.update(zonePrograms).set({ songs: newSongs, songIds: newSongIds, updatedAt: new Date() }).where(eq(zonePrograms.id, targetId));
    }

    res.json({
      success: true,
      message: `Imported ${songsToImport.length} songs into program`,
      data: { totalSongs: newSongs.length },
    });
  } catch (err) {
    console.error('[programs/:id/import-songs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// POST /programs/:id/copy-songs — Append specific song IDs to target program
router.post('/:id/copy-songs', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const { songIds } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      res.status(400).json({ success: false, error: 'songIds array is required' });
      return;
    }

    const [tProg] = await db.select().from(programs).where(eq(programs.id, targetId)).limit(1);
    const [tZProg] = !tProg ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, targetId)).limit(1) : [null];
    const target = tProg || tZProg;

    if (!target) {
      res.status(404).json({ success: false, error: 'Target program not found' });
      return;
    }

    const currentSongIds: string[] = Array.isArray(target.songIds)
      ? (target.songIds as string[])
      : Array.isArray(target.songs)
        ? (target.songs as any[]).map((s: any) => s.id || s)
        : [];

    const updatedSongIds = Array.from(new Set([...currentSongIds, ...songIds]));

    if (tProg) {
      await db.update(programs).set({ songIds: updatedSongIds, updatedAt: new Date() }).where(eq(programs.id, targetId));
    } else {
      await db.update(zonePrograms).set({ songIds: updatedSongIds, updatedAt: new Date() }).where(eq(zonePrograms.id, targetId));
    }

    res.json({
      success: true,
      message: `Added ${songIds.length} songs to program`,
      data: { totalSongIds: updatedSongIds.length },
    });
  } catch (err) {
    console.error('[programs/:id/copy-songs]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// Helper to find a program across programs and zonePrograms tables
async function findProgramRow(programId: string) {
  if (!programId) return null;
  const decoded = decodeURIComponent(programId).trim();
  
  // 1. Check programs table
  const progs = await db.select().from(programs).where(
    or(
      eq(programs.id, programId),
      eq(programs.id, decoded),
      sql`lower(${programs.id}) = lower(${decoded})`,
      sql`${programs.rawData}->>'firebaseId' = ${decoded}`,
      sql`${programs.rawData}->>'id' = ${decoded}`,
      sql`lower(${programs.name}) = lower(${decoded})`
    )
  ).limit(1);

  if (progs.length > 0) return { row: progs[0], table: 'programs' as const };

  // 2. Check zonePrograms table
  const zProgs = await db.select().from(zonePrograms).where(
    or(
      eq(zonePrograms.id, programId),
      eq(zonePrograms.id, decoded),
      sql`lower(${zonePrograms.id}) = lower(${decoded})`,
      sql`${zonePrograms.rawData}->>'firebaseId' = ${decoded}`,
      sql`${zonePrograms.rawData}->>'id' = ${decoded}`,
      sql`lower(${zonePrograms.name}) = lower(${decoded})`
    )
  ).limit(1);

  if (zProgs.length > 0) return { row: zProgs[0], table: 'zonePrograms' as const };

  return null;
}

// PATCH /programs/:id — Update program metadata
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const programId = req.params.id;
    const body = req.body || {};

    const found = await findProgramRow(programId);

    if (!found) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const existing = found.row;
    const prevRaw = (existing.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData))
      ? (existing.rawData as Record<string, unknown>)
      : {};

    const updateFields: Record<string, any> = {
      updatedAt: new Date(),
      rawData: { ...prevRaw, ...body },
    };

    if (body.name !== undefined) updateFields.name = body.name;
    if (body.date !== undefined) updateFields.date = body.date;
    if (body.location !== undefined) updateFields.location = body.location;
    if (body.bannerImage !== undefined) updateFields.bannerImage = body.bannerImage;
    if (body.category !== undefined) {
      updateFields.category = body.category;
      if (body.category === 'ongoing') {
        updateFields.isActive = true;
        updateFields.isArchived = false;
        updateFields.status = 'ongoing';
      } else if (body.category === 'archive') {
        updateFields.isActive = false;
        updateFields.isArchived = true;
        updateFields.status = 'archive';
      }
    }
    if (body.status !== undefined) {
      updateFields.status = body.status;
      updateFields.isActive = body.status === 'ongoing';
      updateFields.isArchived = body.status === 'archive';
    }
    if (body.songs !== undefined) updateFields.songs = body.songs;
    if (body.songIds !== undefined) updateFields.songIds = body.songIds;

    let updatedRow: any = null;
    if (found.table === 'programs') {
      const [u] = await db.update(programs).set(updateFields).where(eq(programs.id, existing.id)).returning();
      updatedRow = u;
    } else {
      const [u] = await db.update(zonePrograms).set(updateFields).where(eq(zonePrograms.id, existing.id)).returning();
      updatedRow = u;
    }

    res.json({ success: true, message: 'Program updated successfully', data: mergeRawRow(updatedRow) });
  } catch (err) {
    console.error('[programs/:id PATCH]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// DELETE /programs/:id — Delete program
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const programId = req.params.id;
    const found = await findProgramRow(programId);

    if (found) {
      if (found.table === 'programs') {
        await db.delete(programs).where(eq(programs.id, found.row.id));
      } else {
        await db.delete(zonePrograms).where(eq(zonePrograms.id, found.row.id));
      }
    } else {
      await Promise.all([
        db.delete(programs).where(eq(programs.id, programId)),
        db.delete(zonePrograms).where(eq(zonePrograms.id, programId)),
      ]);
    }

    res.json({ success: true, message: 'Program deleted successfully' });
  } catch (err) {
    console.error('[programs/:id DELETE]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// PATCH /programs/:id/category-order — Update category order within program
router.patch('/:id/category-order', requireAuth, async (req, res) => {
  try {
    const programId = req.params.id;
    const { categoryOrder } = req.body;

    const [prog] = await db.select().from(programs).where(eq(programs.id, programId)).limit(1);
    const [zProg] = !prog ? await db.select().from(zonePrograms).where(eq(zonePrograms.id, programId)).limit(1) : [null];
    const existing = prog || zProg;

    if (!existing) {
      res.status(404).json({ success: false, error: 'Program not found' });
      return;
    }

    const prevRaw = (existing.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData))
      ? (existing.rawData as Record<string, unknown>)
      : {};

    const updatedRaw = { ...prevRaw, categoryOrder };

    if (prog) {
      await db.update(programs).set({ rawData: updatedRaw, updatedAt: new Date() }).where(eq(programs.id, programId));
    } else {
      await db.update(zonePrograms).set({ rawData: updatedRaw, updatedAt: new Date() }).where(eq(zonePrograms.id, programId));
    }

    res.json({ success: true, message: 'Category order updated successfully' });
  } catch (err) {
    console.error('[programs/:id/category-order]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;


