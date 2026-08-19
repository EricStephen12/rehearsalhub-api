import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { submittedSongs } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

router.get('/', requireAuth, async (req: any, res) => {
  try {
    const { zoneId } = req.query;
    let rows: any[] = [];
    if (zoneId && zoneId !== 'all') {
      rows = await db.select().from(submittedSongs).where(eq(submittedSongs.zoneId, String(zoneId)));
    } else {
      rows = await db.select().from(submittedSongs);
    }

    const data = rows
      .map((r) => {
        const m = mergeRawRow(r);
        return {
          id: String(m.id),
          title: typeof m.title === 'string' ? m.title : 'Untitled Submission',
          status: typeof m.status === 'string' ? m.status : 'pending',
          writer: typeof m.writer === 'string' ? m.writer : m.artist || null,
          artist: typeof m.artist === 'string' ? m.artist : m.writer || null,
          lyrics: typeof m.lyrics === 'string' ? m.lyrics : null,
          audioUrl: typeof m.audioUrl === 'string' ? m.audioUrl : m.audio_url || null,
          category: typeof m.category === 'string' ? m.category : null,
          notes: typeof m.notes === 'string' ? m.notes : null,
          rejectNotes: typeof m.rejectNotes === 'string' ? m.rejectNotes : null,
          zoneName: typeof m.zoneName === 'string' ? m.zoneName : null,
          zoneId: typeof m.zoneId === 'string' ? m.zoneId : null,
          submittedBy: typeof m.submittedBy === 'string' ? m.submittedBy : m.submitted_by || null,
          submittedByEmail: typeof m.submittedByEmail === 'string' ? m.submittedByEmail : null,
          createdAt: m.createdAt ?? null,
          rawData: m.rawData ?? null,
        };
      })
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[submitted-songs:get]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.patch('/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { status, notes, rejectNotes } = req.body;

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    const existingRaw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = {
      ...existingRaw,
      notes: notes !== undefined ? notes : existingRaw.notes,
      rejectNotes: rejectNotes !== undefined ? rejectNotes : existingRaw.rejectNotes,
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user?.id || req.user?.email || 'admin',
    };

    await db
      .update(submittedSongs)
      .set({
        status: status || existing.status,
        rawData: updatedRaw,
      })
      .where(eq(submittedSongs.id, id));

    res.json({ success: true, message: 'Submission updated successfully' });
  } catch (err) {
    console.error('[submitted-songs:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update submission' });
  }
});

router.post('/:id/approve', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    await db
      .update(submittedSongs)
      .set({ status: 'approved' })
      .where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Song approved' });
  } catch (err) {
    console.error('[submitted-songs:approve]', err);
    res.status(500).json({ success: false, error: 'Failed to approve song' });
  }
});

router.post('/:id/reject', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    const existingRaw = (existing?.rawData as Record<string, any>) || {};

    await db
      .update(submittedSongs)
      .set({
        status: 'rejected',
        rawData: { ...existingRaw, rejectNotes: notes, rejectedAt: new Date().toISOString() },
      })
      .where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Song rejected' });
  } catch (err) {
    console.error('[submitted-songs:reject]', err);
    res.status(500).json({ success: false, error: 'Failed to reject song' });
  }
});

router.delete('/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    await db.delete(submittedSongs).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Song submission deleted' });
  } catch (err) {
    console.error('[submitted-songs:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete submission' });
  }
});

export default router;
