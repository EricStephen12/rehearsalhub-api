import { Router } from 'express';
import { eq, or, desc, and, inArray, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { calls, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

// GET /calls — Call history for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId as string;

    const userCalls = await db.select().from(calls)
      .where(
        sql`${calls.callerId} = ${userId} 
          OR ${calls.receiverId} = ${userId} 
          OR ${calls.rawData}->>'callerId' = ${userId} 
          OR ${calls.rawData}->>'receiverId' = ${userId} 
          OR ${calls.rawData}->>'caller_id' = ${userId} 
          OR ${calls.rawData}->>'receiver_id' = ${userId} 
          OR ${calls.rawData}->'participants' ? ${userId}`
      )
      .orderBy(desc(calls.createdAt))
      .limit(100);

    const userIds = Array.from(new Set(userCalls.flatMap(c => {
      const raw = (c.rawData && typeof c.rawData === 'object') ? (c.rawData as any) : {};
      return [c.callerId, c.receiverId, raw.callerId, raw.receiverId, raw.caller_id, raw.receiver_id];
    }).filter(Boolean)));

    const profileMap: Record<string, { name: string; avatar: string | null }> = {};
    if (userIds.length > 0) {
      const userProfiles = await db.select().from(profiles).where(inArray(profiles.id, userIds));
      for (const p of userProfiles) {
        const raw = (p.rawData && typeof p.rawData === 'object') ? (p.rawData as any) : {};
        const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || raw.name || raw.displayName || p.email || 'Member';
        const avatar = p.avatarUrl || raw.avatar || raw.profile_image_url || null;
        profileMap[p.id] = { name, avatar };
      }
    }

    const enrichedCalls = userCalls.map(c => {
      const merged = mergeRawRow(c);
      const raw = (c.rawData && typeof c.rawData === 'object') ? (c.rawData as any) : {};
      
      const callerId = c.callerId || raw.callerId || raw.caller_id;
      const receiverId = c.receiverId || raw.receiverId || raw.receiver_id;
      const callerProf = profileMap[callerId];
      const receiverProf = profileMap[receiverId];

      let rawTime = raw.timestamp || raw.startedAt || raw.createdAt || c.startedAt || c.createdAt;
      let timestampISO = new Date().toISOString();
      if (rawTime) {
        if (typeof rawTime === 'object' && rawTime._seconds) {
          timestampISO = new Date(rawTime._seconds * 1000).toISOString();
        } else if (rawTime instanceof Date) {
          timestampISO = rawTime.toISOString();
        } else if (typeof rawTime === 'string') {
          timestampISO = rawTime;
        }
      }

      return {
        ...merged,
        id: c.id,
        callerId,
        receiverId,
        callerName: (raw.callerName && raw.callerName !== 'Caller') ? raw.callerName : (callerProf?.name || c.callerName || 'Caller'),
        callerAvatar: c.callerAvatar || raw.callerAvatar || callerProf?.avatar || null,
        receiverName: raw.receiverName || receiverProf?.name || 'Member',
        receiverAvatar: raw.receiverAvatar || receiverProf?.avatar || null,
        type: c.type || raw.type || 'voice',
        status: c.status || raw.status || 'ended',
        duration: raw.duration || 0,
        chatId: c.chatId || raw.chatId || raw.chat_id,
        createdAt: timestampISO,
        timestamp: timestampISO,
      };
    });

    res.json({ success: true, count: enrichedCalls.length, data: enrichedCalls });
  } catch (err) {
    console.error('[calls:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load call history' });
  }
});

// GET /calls/:callId — Get specific call details
router.get('/:callId', requireAuth, async (req, res) => {
  try {
    const [call] = await db.select().from(calls).where(eq(calls.id, req.params.callId)).limit(1);
    if (!call) { 
      res.status(404).json({ success: false, error: 'Call not found' }); 
      return; 
    }
    if (call.callerId !== res.locals.auth.userId && call.receiverId !== res.locals.auth.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    res.json({ success: true, data: call });
  } catch (err) {
    console.error('[calls/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to load call' });
  }
});

// POST /calls — Initiate a voice or video call
router.post('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { 
      receiver_id, 
      receiverId, 
      type = 'voice', 
      chat_id, 
      chatId, 
      caller_name, 
      callerName, 
      caller_avatar, 
      callerAvatar,
      room_id,
      roomId
    } = req.body;

    const targetReceiverId = receiver_id || receiverId;
    if (!targetReceiverId || targetReceiverId === auth.userId) {
      res.status(400).json({ success: false, error: 'receiver_id is required' });
      return;
    }
    const [receiver] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, targetReceiverId)).limit(1);
    if (!receiver) {
      res.status(404).json({ success: false, error: 'Receiver not found' });
      return;
    }

    const id = crypto.randomUUID();
    const generatedRoomId = room_id || roomId || `call_${id}`;

    const [call] = await db.insert(calls).values({
      id,
      callerId: auth.userId,
      receiverId: targetReceiverId,
      type: type === 'video' ? 'video' : 'voice',
      callerName: caller_name || callerName || 'Caller',
      callerAvatar: caller_avatar || callerAvatar,
      chatId: chat_id || chatId,
      roomId: generatedRoomId,
      status: 'ringing',
    }).returning();

    broadcast('call', call.id, call);
    broadcast('incoming_call', targetReceiverId, call);
    res.status(201).json({ success: true, data: call });
  } catch (err) {
    console.error('[calls:post]', err);
    res.status(500).json({ success: false, error: 'Failed to initiate call' });
  }
});

// PATCH /calls/:callId — Update call status (answered, declined, ended)
router.patch('/:callId', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const { status } = req.body;
    const auth = res.locals.auth;
    const allowedStatuses = new Set(['ringing', 'answered', 'accepted', 'ended', 'declined', 'missed']);
    if (typeof status !== 'string' || !allowedStatuses.has(status)) {
      res.status(400).json({ success: false, error: 'Invalid call status' });
      return;
    }

    const [existing] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return;
    }
    if (existing.callerId !== auth.userId && existing.receiverId !== auth.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const now = new Date();
    const updates: Partial<typeof calls.$inferInsert> = {
      status,
    };

    if (status === 'answered' || status === 'accepted') {
      updates.startedAt = now;
    } else if (status === 'ended' || status === 'declined' || status === 'missed') {
      updates.endedAt = now;
    }

    const [updated] = await db.update(calls)
      .set(updates)
      .where(eq(calls.id, callId))
      .returning();

    broadcast('call', callId, updated);
    if (existing?.receiverId) broadcast('call_status', existing.receiverId, updated);
    if (existing?.callerId) broadcast('call_status', existing.callerId, updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[calls/:id:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update call' });
  }
});

// POST /calls/:callId/signal — WebRTC signaling relay (offer, answer, ICE candidates)
router.post('/:callId/signal', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const { signal, targetUserId } = req.body;
    const auth = res.locals.auth;

    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    if (!call) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return;
    }
    if (call.callerId !== auth.userId && call.receiverId !== auth.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const destination = targetUserId || (call.callerId === auth.userId ? call.receiverId : call.callerId);
    if (destination !== call.callerId && destination !== call.receiverId) {
      res.status(403).json({ success: false, error: 'Forbidden destination' });
      return;
    }

    broadcast('call_signal', destination, {
      callId,
      from: auth.userId,
      signal,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[calls/:id/signal]', err);
    res.status(500).json({ success: false, error: 'Failed to send signal' });
  }
});

// DELETE /calls/:callId — Delete a specific call log
router.delete('/:callId', requireAuth, async (req, res) => {
  try {
    const { callId } = req.params;
    const auth = res.locals.auth;

    await db.delete(calls).where(
      and(
        eq(calls.id, callId),
        or(eq(calls.callerId, auth.userId), eq(calls.receiverId, auth.userId))
      )
    );
    res.json({ success: true, message: 'Call log deleted' });
  } catch (err) {
    console.error('[calls/:id:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete call log' });
  }
});

// DELETE /calls — Batch delete call logs
router.delete('/', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    const auth = res.locals.auth;

    if (Array.isArray(ids) && ids.length > 0) {
      await db.delete(calls).where(
        and(
          inArray(calls.id, ids),
          or(eq(calls.callerId, auth.userId), eq(calls.receiverId, auth.userId))
        )
      );
    }
    res.json({ success: true, message: 'Call logs deleted' });
  } catch (err) {
    console.error('[calls:batchDelete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete call logs' });
  }
});

export default router;

