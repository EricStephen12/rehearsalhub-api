import { Router } from 'express';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { schedulePrograms } from '../schema';
import { requireAuth, requireTenantAdmin } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function shapeSchedule(row: any) {
  const merged = mergeRawRow(row);
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};

  const dailySchedules = Array.isArray(raw.dailySchedules) ? raw.dailySchedules : (Array.isArray(raw.scheduleSongs) ? raw.scheduleSongs : []);
  const carriedOver = Array.isArray(raw.carriedOver) ? raw.carriedOver : (Array.isArray(raw.carriedOverSongs) ? raw.carriedOverSongs : []);
  const swapped = Array.isArray(raw.swapped) ? raw.swapped : (Array.isArray(raw.swappedSongs) ? raw.swappedSongs : []);
  const nameChanges = Array.isArray(raw.nameChanges) ? raw.nameChanges : (Array.isArray(raw.renamedSongs) ? raw.renamedSongs : []);
  const submitters = Array.isArray(raw.submitters) ? raw.submitters : (Array.isArray(raw.eligibilityList) ? raw.eligibilityList : []);
  const newSongs = Array.isArray(raw.newSongs) ? raw.newSongs : [];
  const invalidSongs = Array.isArray(raw.invalidSongs) ? raw.invalidSongs : [];

  const defaultWeeks = Array.isArray(raw.weeks) && raw.weeks.length > 0 ? raw.weeks : [{ id: 'week_1', name: 'Week 1' }];
  const defaultDays = Array.isArray(raw.days) && raw.days.length > 0 ? raw.days : [{ id: 'day_1', weekId: defaultWeeks[0]?.id || 'week_1', name: 'Day 1' }];

  return {
    ...merged,
    id: String(row.id),
    name: row.name || raw.name || raw.programName || 'Schedule Program',
    date: row.date || raw.date || new Date().toLocaleDateString('en-CA'),
    isArchived: Boolean(raw.isArchived || raw.is_archived),
    isCurrent: Boolean(raw.isCurrent || raw.is_current),
    zoneId: raw.zoneId || row.zoneId || 'global',
    weeks: defaultWeeks,
    days: defaultDays,
    currentWeekId: raw.currentWeekId || defaultWeeks[0]?.id || 'week_1',
    currentDayId: raw.currentDayId || defaultDays[0]?.id || 'day_1',
    dailySchedules,
    scheduleSongs: dailySchedules,
    newSongs,
    carriedOver,
    carriedOverSongs: carriedOver,
    swapped,
    swappedSongs: swapped,
    nameChanges,
    renamedSongs: nameChanges,
    invalidSongs,
    submitters,
    eligibilityList: submitters,
    createdAt: row.createdAt || raw.createdAt || new Date().toISOString(),
    rawData: raw,
  };
}

/** GET /schedule (and /schedule/programs) — List programs */
router.get(['/', '/programs'], requireAuth, async (req, res) => {
  try {
    const { zoneId } = req.query;
    const rows = await db.select().from(schedulePrograms);
    let data = rows.map(shapeSchedule);

    if (zoneId && zoneId !== 'all' && zoneId !== 'global') {
      const target = String(zoneId).toLowerCase();
      data = data.filter((p: any) => {
        const pZone = String(p.zoneId || p.rawData?.zoneId || p.rawData?.zone_id || '').toLowerCase();
        return !pZone || pZone === 'global' || pZone === target;
      });
    }

    data.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[schedule:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load schedule programs' });
  }
});

/** GET /schedule/:scheduleId */
router.get('/:scheduleId', requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(schedulePrograms)
      .where(eq(schedulePrograms.id, req.params.scheduleId))
      .limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Schedule program not found' });
      return;
    }
    res.json({ success: true, data: shapeSchedule(row) });
  } catch (err) {
    console.error('[schedule/:id:get]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
  }
});

/** POST /schedule — Create a new schedule program */
router.post('/', requireAuth, requireTenantAdmin, async (req: any, res) => {
  try {
    const id = crypto.randomUUID();
    const now = new Date();
    const name = req.body.name?.trim() || 'New Schedule Program';
    const date = req.body.date || now.toLocaleDateString('en-CA');
    const zoneId = req.body.zoneId || 'global';

    const defaultWeeks = [{ id: 'week_1', name: 'Week 1' }];
    const defaultDays = [{ id: 'day_1', weekId: 'week_1', name: 'Day 1' }];

    const rawData = {
      id,
      name,
      date,
      zoneId,
      weeks: req.body.weeks || defaultWeeks,
      days: req.body.days || defaultDays,
      dailySchedules: req.body.dailySchedules || [],
      newSongs: req.body.newSongs || [],
      carriedOver: req.body.carriedOver || [],
      swapped: req.body.swapped || [],
      nameChanges: req.body.nameChanges || [],
      invalidSongs: req.body.invalidSongs || [],
      isArchived: false,
      isCurrent: false,
      createdBy: res.locals.auth?.userId || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const [inserted] = await db.insert(schedulePrograms).values({
      id,
      name,
      date,
      createdAt: now,
      rawData,
    }).returning();

    res.status(201).json({ success: true, message: 'Program created', data: shapeSchedule(inserted) });
  } catch (err: any) {
    console.error('[schedule:create]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to create schedule' });
  }
});

/** PATCH /schedule/:scheduleId — Update program contents */
router.patch('/:scheduleId', requireAuth, requireTenantAdmin, async (req: any, res) => {
  try {
    const { scheduleId } = req.params;
    const [existing] = await db.select().from(schedulePrograms).where(eq(schedulePrograms.id, scheduleId)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const existingRaw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = {
      ...existingRaw,
      ...req.body,
      id: scheduleId,
      updatedAt: new Date().toISOString(),
      updatedBy: res.locals.auth.userId,
    };

    const [updated] = await db.update(schedulePrograms)
      .set({
        name: req.body.name || existing.name,
        date: req.body.date || existing.date,
        rawData: updatedRaw,
      })
      .where(eq(schedulePrograms.id, scheduleId))
      .returning();

    res.json({ success: true, message: 'Schedule updated', data: shapeSchedule(updated) });
  } catch (err: any) {
    console.error('[schedule:patch]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to update schedule' });
  }
});

/** DELETE /schedule/:scheduleId */
router.delete('/:scheduleId', requireAuth, requireTenantAdmin, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    await db.delete(schedulePrograms).where(eq(schedulePrograms.id, scheduleId));
    res.json({ success: true, message: 'Schedule program deleted' });
  } catch (err) {
    console.error('[schedule:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete schedule' });
  }
});

export default router;
