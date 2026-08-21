import { Router } from 'express';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { schedulePrograms } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function shapeSchedule(row: any) {
  const merged = mergeRawRow(row);
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};

  return {
    ...merged,
    id: String(row.id),
    name: row.name || raw.name || raw.programName || 'Schedule Program',
    date: row.date || raw.date || new Date().toLocaleDateString('en-CA'),
    isArchived: Boolean(raw.isArchived || raw.is_archived),
    weeks: Array.isArray(raw.weeks) ? raw.weeks : [{ id: 'default_week_1', name: 'Week 1' }],
    days: Array.isArray(raw.days) ? raw.days : [{ id: 'default_day_1', weekId: 'default_week_1', name: 'Day 1' }],
    currentWeekId: raw.currentWeekId || 'default_week_1',
    currentDayId: raw.currentDayId || 'default_day_1',
    scheduleSongs: Array.isArray(raw.scheduleSongs) ? raw.scheduleSongs : [],
    newSongs: Array.isArray(raw.newSongs) ? raw.newSongs : [],
    carriedOverSongs: Array.isArray(raw.carriedOverSongs) ? raw.carriedOverSongs : [],
    swappedSongs: Array.isArray(raw.swappedSongs) ? raw.swappedSongs : [],
    renamedSongs: Array.isArray(raw.renamedSongs) ? raw.renamedSongs : [],
    invalidSongs: Array.isArray(raw.invalidSongs) ? raw.invalidSongs : [],
    eligibilityList: Array.isArray(raw.eligibilityList) ? raw.eligibilityList : [],
    createdAt: row.createdAt || raw.createdAt || new Date().toISOString(),
    rawData: raw,
  };
}

/** GET /schedule (and /schedule/programs) — List programs */
router.get(['/', '/programs'], requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(schedulePrograms);
    const data = rows
      .map(shapeSchedule)
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
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
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const id = crypto.randomUUID();
    const now = new Date();
    const name = req.body.name?.trim() || 'New Schedule Program';
    const date = req.body.date || now.toLocaleDateString('en-CA');

    const defaultWeeks = [{ id: 'week_1', name: 'Week 1' }];
    const defaultDays = [{ id: 'day_1', weekId: 'week_1', name: 'Day 1' }];

    const rawData = {
      id,
      name,
      date,
      weeks: req.body.weeks || defaultWeeks,
      days: req.body.days || defaultDays,
      currentWeekId: req.body.currentWeekId || 'week_1',
      currentDayId: req.body.currentDayId || 'day_1',
      scheduleSongs: req.body.scheduleSongs || [],
      newSongs: req.body.newSongs || [],
      carriedOverSongs: req.body.carriedOverSongs || [],
      swappedSongs: req.body.swappedSongs || [],
      renamedSongs: req.body.renamedSongs || [],
      invalidSongs: req.body.invalidSongs || [],
      eligibilityList: req.body.eligibilityList || [],
      isArchived: false,
      createdBy: res.locals.auth.userId,
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
router.patch('/:scheduleId', requireAuth, async (req: any, res) => {
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
router.delete('/:scheduleId', requireAuth, async (req, res) => {
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
