import { Router } from 'express';
import { eq, desc, asc, or, and } from 'drizzle-orm';
import { db } from '../db';
import { upcomingEvents } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

export const upcomingEventsRouter = Router();

// GET /upcoming-events — Fetch upcoming / calendar events
upcomingEventsRouter.get('/', requireAuth, async (req: any, res: any) => {
  try {
    const { zoneId } = req.query;

    const rows = await db
      .select()
      .from(upcomingEvents)
      .orderBy(desc(upcomingEvents.date));

    let events = rows.map(mergeRawRow);

    if (zoneId) {
      events = events.filter((e: any) => {
        return (
          e.zoneId === zoneId ||
          e.zone_id === zoneId ||
          e.isGlobal === true ||
          !e.zoneId
        );
      });
    }

    res.json({
      success: true,
      count: events.length,
      data: events,
    });
  } catch (err) {
    console.error('[upcomingEvents:GET]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming events' });
  }
});

// GET /upcoming-events/:id — Get single event
upcomingEventsRouter.get('/:id', requireAuth, async (req: any, res: any) => {
  try {
    const [row] = await db
      .select()
      .from(upcomingEvents)
      .where(eq(upcomingEvents.id, req.params.id))
      .limit(1);

    if (!row) {
      res.status(404).json({ success: false, error: 'Event not found' });
      return;
    }

    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    console.error('[upcomingEvents:GET_BY_ID]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch event' });
  }
});

// POST /upcoming-events — Create event
upcomingEventsRouter.post('/', requireAuth, async (req: any, res: any) => {
  try {
    const body = req.body || {};
    const id = body.id || `upcoming-${Date.now()}`;
    const now = new Date().toISOString();

    const rawData = {
      ...body,
      id,
      createdAt: body.createdAt || now,
      updatedAt: now,
      showInCarousel: body.showInCarousel !== false,
    };

    const newRecord = {
      id,
      title: body.title || 'Untitled Event',
      date: body.date || now.split('T')[0],
      type: body.type || 'event',
      zoneId: body.zoneId || null,
      location: body.location || null,
      description: body.description || null,
      rawData,
    };

    await db.insert(upcomingEvents).values(newRecord);

    res.json({
      success: true,
      data: mergeRawRow(newRecord),
    });
  } catch (err) {
    console.error('[upcomingEvents:POST]', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

// PATCH /upcoming-events/:id — Update event
upcomingEventsRouter.patch('/:id', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const now = new Date().toISOString();

    const [existing] = await db
      .select()
      .from(upcomingEvents)
      .where(eq(upcomingEvents.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ success: false, error: 'Event not found' });
      return;
    }

    const mergedData = {
      ...(existing.rawData as Record<string, any> || {}),
      ...body,
      id,
      updatedAt: now,
    };

    const updateFields: any = {
      rawData: mergedData,
    };

    if (body.title !== undefined) updateFields.title = body.title;
    if (body.date !== undefined) updateFields.date = body.date;
    if (body.type !== undefined) updateFields.type = body.type;
    if (body.zoneId !== undefined) updateFields.zoneId = body.zoneId;
    if (body.location !== undefined) updateFields.location = body.location;
    if (body.description !== undefined) updateFields.description = body.description;

    await db
      .update(upcomingEvents)
      .set(updateFields)
      .where(eq(upcomingEvents.id, id));

    res.json({
      success: true,
      data: mergeRawRow({ ...existing, ...updateFields, rawData: mergedData }),
    });
  } catch (err) {
    console.error('[upcomingEvents:PATCH]', err);
    res.status(500).json({ success: false, error: 'Failed to update event' });
  }
});

// DELETE /upcoming-events/:id — Delete event
upcomingEventsRouter.delete('/:id', requireAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    await db.delete(upcomingEvents).where(eq(upcomingEvents.id, id));
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (err) {
    console.error('[upcomingEvents:DELETE]', err);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
});
