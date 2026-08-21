import { Router } from 'express';
import { eq, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { programs, zonePrograms } from '../schema';
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
    const effectiveZoneId = queryZoneId || (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[] = [];

    if (effectiveZoneId && effectiveZoneId !== 'zone-001' && !effectiveZoneId.toLowerCase().includes('hq') && effectiveZoneId !== 'ZONE001') {
      const [zRows, globalRows] = await Promise.all([
        db.select().from(zonePrograms),
        db.select().from(programs).where(eq(programs.zoneId, effectiveZoneId)),
      ]);
      const mergedZ = zRows.map(mergeRawRow).filter((r: any) => !r.zoneId || r.zoneId === effectiveZoneId || r.zone_id === effectiveZoneId);
      const mergedGlobal = globalRows.map(mergeRawRow);
      rows = [...mergedZ, ...mergedGlobal];
      if (rows.length === 0) {
        const allGlobal = await db.select().from(programs);
        rows = allGlobal.map(mergeRawRow);
      }
    } else {
      const allGlobal = await db.select().from(programs);
      rows = allGlobal.map(mergeRawRow);
    }

    let data = rows.sort((a, b) => {
      const ac = String(a.createdAt ?? a.date ?? '');
      const bc = String(b.createdAt ?? b.date ?? '');
      return bc.localeCompare(ac);
    });

    if (category) {
      const target = category.toLowerCase();
      data = data.filter((p: any) => {
        const cat = (p.category || '').toLowerCase();
        const stat = (p.status || '').toLowerCase();
        return cat === target || stat === target;
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

// PATCH /programs/:id — Update program metadata
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const programId = req.params.id;
    const body = req.body || {};

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
    if (prog) {
      const [u] = await db.update(programs).set(updateFields).where(eq(programs.id, programId)).returning();
      updatedRow = u;
    } else {
      const [u] = await db.update(zonePrograms).set(updateFields).where(eq(zonePrograms.id, programId)).returning();
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

    await Promise.all([
      db.delete(programs).where(eq(programs.id, programId)),
      db.delete(zonePrograms).where(eq(zonePrograms.id, programId)),
    ]);

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


