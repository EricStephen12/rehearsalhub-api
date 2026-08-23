import { Router } from 'express';
import { eq, or, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { calls } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';

const router = Router();

// GET /calls — Call history for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const userCalls = await db.select().from(calls)
      .where(or(eq(calls.callerId, auth.userId), eq(calls.receiverId, auth.userId)))
      .orderBy(desc(calls.createdAt))
      .limit(50);
    res.json({ success: true, data: userCalls });
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
    if (!targetReceiverId) {
      res.status(400).json({ success: false, error: 'receiver_id is required' });
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

    const [existing] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Call not found' });
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
    broadcast('call_status', existing.receiverId, updated);
    broadcast('call_status', existing.callerId, updated);
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

    const destination = targetUserId || (call.callerId === auth.userId ? call.receiverId : call.callerId);

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

export default router;

