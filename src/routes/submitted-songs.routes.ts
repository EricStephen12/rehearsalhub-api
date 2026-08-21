import { Router } from 'express';
import { eq, or, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { submittedSongs, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function shapeSubmission(r: any) {
  const m = mergeRawRow(r);
  const raw = (r.rawData && typeof r.rawData === 'object') ? (r.rawData as Record<string, any>) : {};

  const title = (m.title as string) || (raw.songTitle as string) || (raw.title as string) || 'Untitled Song';
  const writer = (m.writer as string) || (raw.writer as string) || (m.composer as string) || (raw.composer as string) || (m.artist as string) || (raw.artist as string) || 'Unknown Composer';
  const artist = (m.artist as string) || (raw.artist as string) || (m.leadSinger as string) || (raw.leadSinger as string) || writer;
  const leadSinger = (m.leadSinger as string) || (raw.leadSinger as string) || (raw.lead_singer as string) || '';
  const lyrics = (m.lyrics as string) || (raw.lyrics as string) || '';
  const audioUrl = (m.audioUrl as string) || (raw.audioUrl as string) || (raw.audio_url as string) || (raw.audioFile as string) || null;
  const key = (m.key as string) || (raw.key as string) || (raw.songKey as string) || '';
  const tempo = (m.tempo as string) || (raw.tempo as string) || '';
  const solfas = (m.solfas as string) || (raw.solfas as string) || (raw.solfa as string) || '';
  const category = (m.category as string) || (raw.category as string) || 'General';
  const notes = (m.notes as string) || (raw.notes as string) || '';
  const rejectNotes = (m.rejectNotes as string) || (raw.rejectNotes as string) || (raw.rejection_reason as string) || '';
  const zoneName = (m.zoneName as string) || (raw.zoneName as string) || (raw.zone_name as string) || '';
  const zoneId = (m.zoneId as string) || (r.zoneId as string) || (raw.zoneId as string) || (raw.zone_code as string) || '';
  const submittedBy = (m.submittedBy as string) || (raw.submittedByName as string) || (raw.submitted_by_name as string) || (raw.userName as string) || (raw.user_name as string) || (r.submittedBy as string) || writer;
  const submittedByEmail = (m.submittedByEmail as string) || (raw.submittedByEmail as string) || (raw.submitted_by_email as string) || (raw.userEmail as string) || (raw.user_email as string) || (r.submittedByEmail as string) || '';
  const status = (m.status as string) || (r.status as string) || 'pending';
  const createdAt = r.createdAt || raw.createdAt || raw.created_at || new Date().toISOString();

  return {
    ...m,
    id: String(r.id),
    userId: r.userId || raw.userId || raw.user_id || null,
    title,
    writer,
    artist,
    leadSinger,
    lyrics,
    audioUrl,
    key,
    tempo,
    solfas,
    category,
    notes,
    rejectNotes,
    zoneName,
    zoneId,
    submittedBy,
    submittedByEmail,
    status,
    createdAt,
    rawData: raw,
  };
}

/** GET /submitted-songs (or /submissions) — List submissions */
router.get('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { zoneId, status, mine } = req.query;

    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = (zoneId && zoneId !== 'all') ? String(zoneId) : (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[] = [];
    if (mine === 'true' || auth.role === 'user' || auth.role === 'member') {
      rows = await db.select().from(submittedSongs).where(eq(submittedSongs.userId, auth.userId));
    } else if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      rows = await db.select().from(submittedSongs).where(
        sql`lower(replace(${submittedSongs.zoneId}, '-', '')) = ${withoutHyphen} OR 
            lower(${submittedSongs.zoneId}) = ${withHyphen} OR 
            lower(replace(${submittedSongs.rawData}->>'zoneId', '-', '')) = ${withoutHyphen} OR 
            lower(replace(${submittedSongs.rawData}->>'zone_code', '-', '')) = ${withoutHyphen}`
      );
    } else {
      rows = await db.select().from(submittedSongs);
    }

    let data = rows.map(shapeSubmission);
    if (status && status !== 'all') {
      data = data.filter((s) => s.status === status);
    }

    data.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[submitted-songs:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load submitted songs' });
  }
});

/** GET /submitted-songs/mine */
router.get('/mine', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId;
    const rows = await db.select().from(submittedSongs).where(eq(submittedSongs.userId, userId));
    const data = rows.map(shapeSubmission).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[submitted-songs:mine]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch your submissions' });
  }
});

/** POST /submitted-songs (or /submissions) — Create song submission */
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const [userProfile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    const rawProfile = (userProfile?.rawData && typeof userProfile.rawData === 'object') ? (userProfile.rawData as Record<string, any>) : {};

    const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ') || (rawProfile.first_name ? `${rawProfile.first_name} ${rawProfile.last_name || ''}` : '') || auth.email;
    const userEmail = userProfile?.email || auth.email || '';
    const userZone = req.body.zoneId || rawProfile.zone_code || rawProfile.zoneId || 'general';

    const submissionRaw = {
      id,
      userId,
      user_id: userId,
      title: req.body.title?.trim() || 'Untitled Song',
      writer: req.body.writer?.trim() || fullName,
      artist: req.body.artist?.trim() || req.body.leadSinger?.trim() || fullName,
      leadSinger: req.body.leadSinger?.trim() || '',
      lyrics: req.body.lyrics?.trim() || '',
      key: req.body.key?.trim() || '',
      tempo: req.body.tempo?.trim() || '',
      solfas: req.body.solfas?.trim() || '',
      category: req.body.category || 'General',
      notes: req.body.notes?.trim() || '',
      audioUrl: req.body.audioUrl || req.body.audio_url || null,
      zoneId: userZone,
      zoneName: req.body.zoneName || 'Assigned Zone',
      submittedBy: fullName,
      submittedByEmail: userEmail,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const [inserted] = await db.insert(submittedSongs).values({
      id,
      userId,
      title: submissionRaw.title,
      status: 'pending',
      zoneId: userZone,
      submittedBy: fullName,
      submittedByEmail: userEmail,
      createdAt: new Date(),
      rawData: submissionRaw,
    }).returning();

    res.status(201).json({
      success: true,
      message: 'Song submitted successfully',
      data: shapeSubmission(inserted),
    });
  } catch (err: any) {
    console.error('[submitted-songs:create]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to submit song' });
  }
});

/** PATCH /submitted-songs/:id */
router.patch('/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { status, notes, rejectNotes, title, lyrics, writer, leadSinger, key, audioUrl } = req.body;

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    const existingRaw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = {
      ...existingRaw,
      ...(title !== undefined ? { title: title.trim(), songTitle: title.trim() } : {}),
      ...(lyrics !== undefined ? { lyrics: lyrics.trim() } : {}),
      ...(writer !== undefined ? { writer: writer.trim(), composer: writer.trim() } : {}),
      ...(leadSinger !== undefined ? { leadSinger: leadSinger.trim() } : {}),
      ...(key !== undefined ? { key: key.trim() } : {}),
      ...(audioUrl !== undefined ? { audioUrl, audio_url: audioUrl } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(rejectNotes !== undefined ? { rejectNotes } : {}),
      ...(status !== undefined ? { status } : {}),
      updatedAt: new Date().toISOString(),
      reviewedBy: res.locals.auth.userId,
    };

    const [updated] = await db
      .update(submittedSongs)
      .set({
        title: title || existing.title,
        status: status || existing.status,
        rawData: updatedRaw,
      })
      .where(eq(submittedSongs.id, id))
      .returning();

    res.json({ success: true, message: 'Submission updated', data: shapeSubmission(updated) });
  } catch (err) {
    console.error('[submitted-songs:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update submission' });
  }
});

/** POST /submitted-songs/:id/approve */
router.post('/:id/approve', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = { ...raw, status: 'approved', approvedAt: new Date().toISOString(), approvedBy: res.locals.auth.userId };

    await db.update(submittedSongs).set({ status: 'approved', rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Song approved successfully' });
  } catch (err) {
    console.error('[submitted-songs:approve]', err);
    res.status(500).json({ success: false, error: 'Failed to approve song' });
  }
});

/** POST /submitted-songs/:id/reject */
router.post('/:id/reject', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { notes, reason } = req.body;
    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = {
      ...raw,
      status: 'rejected',
      rejectNotes: notes || reason || raw.rejectNotes,
      rejectedAt: new Date().toISOString(),
      rejectedBy: res.locals.auth.userId,
    };

    await db.update(submittedSongs).set({ status: 'rejected', rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Song submission rejected' });
  } catch (err) {
    console.error('[submitted-songs:reject]', err);
    res.status(500).json({ success: false, error: 'Failed to reject song' });
  }
});

/** DELETE /submitted-songs/:id */
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

/** POST /submitted-songs/:id/reply */
router.post('/:id/reply', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { message, senderName } = req.body;
    const auth = res.locals.auth;

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const conversation = Array.isArray(raw.conversation) ? [...raw.conversation] : [];
    
    const isUserSender = existing.userId === auth.userId;
    const newMessage = {
      id: `msg-${Date.now()}`,
      sender: isUserSender ? 'user' : 'admin',
      senderName: senderName || auth.email || (isUserSender ? 'Singer' : 'Admin'),
      message: message?.trim() || '',
      timestamp: new Date().toISOString(),
    };

    conversation.push(newMessage);

    const updatedRaw = {
      ...raw,
      conversation,
      ...(isUserSender ? { userReply: message?.trim() } : { replyMessage: message?.trim() }),
      updatedAt: new Date().toISOString(),
    };

    await db.update(submittedSongs).set({ rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Reply sent successfully', data: conversation });
  } catch (err) {
    console.error('[submitted-songs:reply]', err);
    res.status(500).json({ success: false, error: 'Failed to post reply' });
  }
});

export default router;
