import { Router } from 'express';
import { eq, or, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { submittedSongs, profiles, notifications } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';
import { broadcast } from '../ws/wsServer';

const router = Router();

async function createSubmissionNotification({
  targetUserId,
  targetAudience,
  title,
  message,
  type = 'info',
  category = 'song_submission',
  priority = 'normal',
  senderName = 'Ministry Review Team',
  senderId,
  submissionId,
  zoneId,
}: {
  targetUserId?: string | null;
  targetAudience?: string;
  title: string;
  message: string;
  type?: string;
  category?: string;
  priority?: string;
  senderName?: string;
  senderId?: string;
  submissionId: string;
  zoneId?: string;
}) {
  try {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const rawData = {
      id,
      title,
      message,
      body: message,
      type,
      category,
      priority,
      target_audience: targetAudience || (targetUserId ? 'user' : 'all'),
      targetAudience: targetAudience || (targetUserId ? 'user' : 'all'),
      target_user_id: targetUserId || null,
      targetUserId: targetUserId || null,
      target_zone_id: zoneId || null,
      sender_id: senderId || null,
      sender_name: senderName,
      sentBy: senderName,
      actionUrl: '/pages/submit-song',
      action_url: '/pages/submit-song',
      submissionId,
      created_at: now,
      createdAt: now,
      sentAt: now,
      is_read: false,
    };

    const notifRecord = {
      id,
      title,
      message,
      type,
      category,
      priority,
      targetAudience: targetAudience || (targetUserId ? 'user' : 'all'),
      targetUserId: targetUserId || null,
      zoneId: zoneId || null,
      senderId: senderId || null,
      actionUrl: '/pages/submit-song',
      isRead: false,
      createdAt: now,
      rawData,
    };

    await db.insert(notifications).values(notifRecord);

    broadcast('notifications', 'all', notifRecord);
  } catch (err) {
    console.error('[createSubmissionNotification] Error:', err);
  }
}

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
  const conversation = Array.isArray(m.conversation) ? m.conversation : (Array.isArray(raw.conversation) ? raw.conversation : []);

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
    conversation,
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

    const HQ_GROUP_IDS = new Set([
      'zone-001', 'zone-002', 'zone-003', 'zone-004', 'zone-005',
      'loveworld-singers-hq', 'zone001', 'zone002', 'zone003', 'zone004', 'zone005',
      'hq', 'global', 'all'
    ]);

    let rows: any[] = [];
    if (mine === 'true' || auth.role === 'user' || auth.role === 'member') {
      rows = await db.select().from(submittedSongs).where(eq(submittedSongs.userId, auth.userId));
    } else if (effectiveZoneId && !HQ_GROUP_IDS.has(effectiveZoneId.toLowerCase().trim())) {
      const cleanZone = effectiveZoneId.toLowerCase().trim();
      const withoutHyphen = cleanZone.replace(/[\s-_]/g, '');
      const withHyphen = cleanZone.includes('-') ? cleanZone : cleanZone.replace(/^zone(\d+)$/, 'zone-$1');

      rows = await db.select().from(submittedSongs).where(
        sql`lower(replace(replace(${submittedSongs.zoneId}, '-', ''), ' ', '')) = ${withoutHyphen} OR 
            lower(${submittedSongs.zoneId}) = ${cleanZone} OR 
            lower(${submittedSongs.zoneId}) = ${withHyphen} OR 
            lower(replace(replace(${submittedSongs.rawData}->>'zoneId', '-', ''), ' ', '')) = ${withoutHyphen} OR 
            lower(replace(replace(${submittedSongs.rawData}->>'zone_code', '-', ''), ' ', '')) = ${withoutHyphen}`
      );
    } else {
      // HQ Scope / Global View: include all submissions (unassigned, international, pending)
      rows = await db.select().from(submittedSongs);
    }

    let data = rows.map(shapeSubmission);
    if (status && status !== 'all') {
      data = data.filter((s) => s.status === status);
    }

    function getActivityTimestamp(s: any): number {
      const candidates = [
        s.lastActivityAt,
        s.updatedAt,
        s.createdAt,
        s.rawData?.lastActivityAt,
        s.rawData?.updatedAt,
        s.rawData?.createdAt,
        s.rawData?.submittedAt,
      ];
      if (Array.isArray(s.conversation) && s.conversation.length > 0) {
        const lastMsg = s.conversation[s.conversation.length - 1];
        if (lastMsg?.timestamp) candidates.push(lastMsg.timestamp);
      }
      for (const c of candidates) {
        if (c) {
          const ms = new Date(c).getTime();
          if (!isNaN(ms) && ms > 0) return ms;
        }
      }
      return 0;
    }

    // Sort by latest update / reply / submission to the top
    data.sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
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

    const songTitle = existing.title || raw.songTitle || raw.title || 'Submitted Song';
    if (existing.userId) {
      await createSubmissionNotification({
        targetUserId: existing.userId,
        title: `Song Submission Approved! 🎉`,
        message: `Congratulations! Your song "${songTitle}" has been approved by the ministry review team.`,
        type: 'success',
        category: 'song_submission',
        priority: 'high',
        senderName: res.locals.auth.name || 'HQ Admin',
        senderId: res.locals.auth.userId,
        submissionId: id,
        zoneId: existing.zoneId || undefined,
      });
    }

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

    const songTitle = existing.title || raw.songTitle || raw.title || 'Submitted Song';
    const reasonText = notes || reason || raw.rejectNotes || 'Please check feedback notes.';
    if (existing.userId) {
      await createSubmissionNotification({
        targetUserId: existing.userId,
        title: `Song Submission Update: "${songTitle}"`,
        message: `Feedback on your song "${songTitle}": ${reasonText}`,
        type: 'info',
        category: 'song_submission',
        priority: 'normal',
        senderName: res.locals.auth.name || 'HQ Admin',
        senderId: res.locals.auth.userId,
        submissionId: id,
        zoneId: existing.zoneId || undefined,
      });
    }

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

/** POST /submitted-songs/:id/reply — Post comment/reply */
router.post('/:id/reply', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { message, senderName, replyTo } = req.body;
    const auth = res.locals.auth;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty' });
    }

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const conversation = Array.isArray(raw.conversation) ? [...raw.conversation] : [];
    
    const isUserSender = existing.userId === auth.userId;
    const newMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sender: isUserSender ? 'user' : 'admin',
      senderId: auth.userId,
      senderName: senderName || auth.email || (isUserSender ? 'Singer' : 'Admin Reviewer'),
      message: message.trim(),
      replyTo: replyTo && typeof replyTo === 'object' ? {
        id: replyTo.id,
        text: String(replyTo.text || '').substring(0, 120),
        senderName: replyTo.senderName || 'Unknown',
      } : null,
      reactions: {},
      timestamp: new Date().toISOString(),
    };

    conversation.push(newMessage);

    const updatedRaw = {
      ...raw,
      conversation,
      ...(isUserSender ? { userReply: message.trim() } : { replyMessage: message.trim() }),
      lastActivityAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.update(submittedSongs).set({ rawData: updatedRaw }).where(eq(submittedSongs.id, id));

    const songTitle = existing.title || raw.songTitle || raw.title || 'Submitted Song';
    if (!isUserSender && existing.userId) {
      // Admin replied to singer -> notify singer
      await createSubmissionNotification({
        targetUserId: existing.userId,
        title: `New Message on "${songTitle}"`,
        message: `${newMessage.senderName}: "${message.trim().substring(0, 100)}"`,
        type: 'info',
        category: 'song_submission',
        priority: 'high',
        senderName: newMessage.senderName,
        senderId: auth.userId,
        submissionId: id,
        zoneId: existing.zoneId || undefined,
      });
    } else if (isUserSender) {
      // Singer replied -> Notify admin reviewers
      await createSubmissionNotification({
        targetAudience: 'admins',
        title: `Reply on Song: "${songTitle}"`,
        message: `${newMessage.senderName}: "${message.trim().substring(0, 100)}"`,
        type: 'info',
        category: 'song_submission',
        priority: 'normal',
        senderName: newMessage.senderName,
        senderId: auth.userId,
        submissionId: id,
        zoneId: existing.zoneId || undefined,
      });
    }

    res.json({ success: true, message: 'Message sent successfully', data: conversation, newMessage });
  } catch (err) {
    console.error('[submitted-songs:reply]', err);
    res.status(500).json({ success: false, error: 'Failed to post reply' });
  }
});

/** PATCH /submitted-songs/:id/conversation/:messageId — Edit message */
router.patch('/:id/conversation/:messageId', requireAuth, async (req: any, res) => {
  try {
    const { id, messageId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Updated message cannot be empty' });
    }

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Submission not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const conversation = Array.isArray(raw.conversation) ? [...raw.conversation] : [];

    const msgIdx = conversation.findIndex((m: any) => m.id === messageId);
    if (msgIdx === -1) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    conversation[msgIdx] = {
      ...conversation[msgIdx],
      message: message.trim(),
      isEdited: true,
      editedAt: new Date().toISOString(),
    };

    const updatedRaw = {
      ...raw,
      conversation,
      updatedAt: new Date().toISOString(),
    };

    await db.update(submittedSongs).set({ rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Message updated', data: conversation });
  } catch (err) {
    console.error('[submitted-songs:edit-message]', err);
    res.status(500).json({ success: false, error: 'Failed to edit message' });
  }
});

/** DELETE /submitted-songs/:id/conversation/:messageId — Delete message */
router.delete('/:id/conversation/:messageId', requireAuth, async (req: any, res) => {
  try {
    const { id, messageId } = req.params;

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Submission not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const conversation = (Array.isArray(raw.conversation) ? raw.conversation : []).filter(
      (m: any) => m.id !== messageId
    );

    const updatedRaw = {
      ...raw,
      conversation,
      updatedAt: new Date().toISOString(),
    };

    await db.update(submittedSongs).set({ rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, message: 'Message deleted', data: conversation });
  } catch (err) {
    console.error('[submitted-songs:delete-message]', err);
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

/** POST /submitted-songs/:id/conversation/:messageId/react — Toggle emoji reaction */
router.post('/:id/conversation/:messageId/react', requireAuth, async (req: any, res) => {
  try {
    const { id, messageId } = req.params;
    const { emoji } = req.body;
    const auth = res.locals.auth;

    if (!emoji) return res.status(400).json({ success: false, error: 'Emoji is required' });

    const [existing] = await db.select().from(submittedSongs).where(eq(submittedSongs.id, id)).limit(1);
    if (!existing) return res.status(404).json({ success: false, error: 'Submission not found' });

    const raw = (existing.rawData as Record<string, any>) || {};
    const conversation = Array.isArray(raw.conversation) ? [...raw.conversation] : [];

    const msgIdx = conversation.findIndex((m: any) => m.id === messageId);
    if (msgIdx === -1) return res.status(404).json({ success: false, error: 'Message not found' });

    const msg = conversation[msgIdx];
    const reactions = { ...(msg.reactions || {}) };
    const currentUsers: string[] = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];

    const userIdentifier = auth.userId || auth.email || 'user';
    if (currentUsers.includes(userIdentifier)) {
      reactions[emoji] = currentUsers.filter((u: string) => u !== userIdentifier);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...currentUsers, userIdentifier];
    }

    conversation[msgIdx] = { ...msg, reactions };

    const updatedRaw = {
      ...raw,
      conversation,
      updatedAt: new Date().toISOString(),
    };

    await db.update(submittedSongs).set({ rawData: updatedRaw }).where(eq(submittedSongs.id, id));
    res.json({ success: true, data: conversation });
  } catch (err) {
    console.error('[submitted-songs:react]', err);
    res.status(500).json({ success: false, error: 'Failed to react' });
  }
});

export default router;
