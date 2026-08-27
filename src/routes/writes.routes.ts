/**
 * Write endpoints for Phase 9.
 * Every mutation broadcasts to WebSocket subscribers of the affected resource.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  profiles, individualSubscriptions,
  chatsV2, messagesV2, callsV2,
  zoneMembers, hqMembers, mediaDoodles, userSongNotes,
} from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { broadcast } from '../ws/wsServer';

export const writesRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function forbidden(res: any) {
  res.status(403).json({ success: false, error: 'Forbidden' });
}

function notFound(res: any) {
  res.status(404).json({ success: false, error: 'Not found' });
}

// ── Subscriptions write ───────────────────────────────────────────────────────

writesRouter.patch('/subscriptions/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const auth = res.locals.auth;
  if (auth.userId !== userId && auth.role !== 'hq_admin') { forbidden(res); return; }

  const schema = z.object({
    status: z.enum(['active', 'inactive', 'expired']).optional(),
    plan: z.string().optional(),
    expires_at: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [updated] = await db.update(individualSubscriptions)
    .set({ ...parsed.data as any, updatedAt: new Date() })
    .where(eq(individualSubscriptions.userId, userId))
    .returning();

  if (!updated) { notFound(res); return; }
  broadcast('subscription', userId, updated);
  res.json({ success: true, data: updated });
});

// ── Chats & Messages ──────────────────────────────────────────────────────────

function chatMemberIds(chat: { participants: unknown; rawData?: unknown }): string[] {
  if (Array.isArray(chat.participants)) return chat.participants as string[];
  const raw = chat.rawData && typeof chat.rawData === 'object' ? (chat.rawData as Record<string, unknown>) : {};
  if (Array.isArray(raw.participants)) return raw.participants as string[];
  if (Array.isArray(raw.memberIds)) return raw.memberIds as string[];
  return [];
}

writesRouter.post('/chats', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  const schema = z.object({
    name: z.string().optional(),
    type: z.string(),
    zone_id: z.string().optional(),
    member_ids: z.array(z.string()).min(1),
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const participants = parsed.data.member_ids.includes(auth.userId)
    ? parsed.data.member_ids
    : [...parsed.data.member_ids, auth.userId];

  const [chat] = await db.insert(chatsV2).values({
    id: crypto.randomUUID(),
    type: parsed.data.type,
    createdBy: auth.userId,
    participants,
    participantDetails: {},
    unreadCount: {},
    rawData: {
      name: parsed.data.name,
      zoneId: parsed.data.zone_id,
      participants,
    },
  }).returning();

  broadcast('chat', chat.id, chat);
  res.status(201).json({ success: true, data: chat });
});

writesRouter.patch('/chats/:chatId', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const auth = res.locals.auth;

  const schema = z.object({
    name: z.string().optional(),
    last_message: z.string().optional(),
    last_message_at: z.string().datetime().optional(),
    member_ids: z.array(z.string()).min(1).optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'Empty body' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [chat] = await db.select().from(chatsV2).where(eq(chatsV2.id, chatId)).limit(1);
  if (!chat) { notFound(res); return; }
  if (!chatMemberIds(chat).includes(auth.userId)) { forbidden(res); return; }

  const prevRaw =
    chat.rawData && typeof chat.rawData === 'object' ? (chat.rawData as Record<string, unknown>) : {};
  const nextRaw = {
    ...prevRaw,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.last_message !== undefined ? { lastMessage: parsed.data.last_message } : {}),
    ...(parsed.data.last_message_at !== undefined ? { lastMessageAt: parsed.data.last_message_at } : {}),
  };

  const [updated] = await db.update(chatsV2)
    .set({
      ...(parsed.data.member_ids !== undefined ? { participants: parsed.data.member_ids } : {}),
      rawData: nextRaw,
    })
    .where(eq(chatsV2.id, chatId))
    .returning();

  broadcast('chat', chatId, updated);
  res.json({ success: true, data: updated });
});

// PATCH /chats/:chatId/messages/:msgId — edit text, star, or pin a message
writesRouter.patch('/chats/:chatId/messages/:msgId', requireAuth, async (req, res) => {
  const { chatId, msgId } = req.params;
  const auth = res.locals.auth;

  const schema = z.object({
    content: z.string().min(1).optional(),
    edited: z.boolean().optional(),
    starred: z.boolean().optional(),
    pinned: z.boolean().optional(),
  }).refine(b => Object.keys(b).length > 0, { message: 'Empty body' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [chat] = await db.select().from(chatsV2).where(eq(chatsV2.id, chatId)).limit(1);
  if (!chat) { notFound(res); return; }
  if (!chatMemberIds(chat).includes(auth.userId)) { forbidden(res); return; }

  const [msg] = await db.select().from(messagesV2).where(eq(messagesV2.id, msgId)).limit(1);
  if (!msg) { notFound(res); return; }

  // Only the sender can edit or the text content; anyone in the chat can star/pin their copy
  if (parsed.data.content !== undefined && msg.senderId !== auth.userId) { forbidden(res); return; }

  const prevRaw = msg.rawData && typeof msg.rawData === 'object' ? (msg.rawData as Record<string, unknown>) : {};
  const [updated] = await db.update(messagesV2)
    .set({
      ...(parsed.data.content !== undefined ? { text: parsed.data.content, edited: true } : {}),
      rawData: {
        ...prevRaw,
        ...(parsed.data.starred !== undefined ? { starred: parsed.data.starred } : {}),
        ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      },
    })
    .where(eq(messagesV2.id, msgId))
    .returning();

  // Broadcast edit so all open chat clients update in real-time
  broadcast('messages', chatId, {
    type: 'edit',
    messageId: msgId,
    text: updated.text,
    edited: updated.edited,
    rawData: updated.rawData,
  });
  res.json({ success: true, data: updated });
});

// DELETE /chats/:chatId/messages/:msgId — soft-delete (sender only)
writesRouter.delete('/chats/:chatId/messages/:msgId', requireAuth, async (req, res) => {
  const { chatId, msgId } = req.params;
  const auth = res.locals.auth;

  const [chat] = await db.select().from(chatsV2).where(eq(chatsV2.id, chatId)).limit(1);
  if (!chat) { notFound(res); return; }
  if (!chatMemberIds(chat).includes(auth.userId)) { forbidden(res); return; }

  const [msg] = await db.select().from(messagesV2).where(eq(messagesV2.id, msgId)).limit(1);
  if (!msg) { notFound(res); return; }
  if (msg.senderId !== auth.userId) { forbidden(res); return; }

  const prevRaw = msg.rawData && typeof msg.rawData === 'object' ? (msg.rawData as Record<string, unknown>) : {};
  await db.update(messagesV2)
    .set({
      text: 'This message was deleted',
      rawData: { ...prevRaw, deleted: true, deletedAt: new Date().toISOString() },
    })
    .where(eq(messagesV2.id, msgId));

  // Broadcast delete event so all clients immediately show "deleted" state
  broadcast('messages', chatId, { type: 'delete', messageId: msgId });
  res.json({ success: true });
});

writesRouter.patch('/calls/:callId', requireAuth, async (req, res) => {
  const { callId } = req.params;
  const auth = res.locals.auth;

  const schema = z.object({ status: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [call] = await db.select().from(callsV2).where(eq(callsV2.id, callId)).limit(1);
  if (!call) { notFound(res); return; }
  if (call.callerId !== auth.userId && call.receiverId !== auth.userId) { forbidden(res); return; }

  const [updated] = await db.update(callsV2)
    .set({ status: parsed.data.status })
    .where(eq(callsV2.id, callId))
    .returning();

  broadcast('call', callId, updated);
  res.json({ success: true, data: updated });
});

writesRouter.post('/calls', requireAuth, async (req, res) => {
  const auth = res.locals.auth;

  const schema = z.object({
    receiver_id: z.string(),
    type: z.enum(['voice', 'video']).default('voice'),
    chat_id: z.string().optional(),
    room_id: z.string().optional(),
    caller_name: z.string().optional(),
    caller_avatar: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [call] = await db.insert(callsV2).values({
    id: crypto.randomUUID(),
    callerId: auth.userId,
    receiverId: parsed.data.receiver_id,
    type: parsed.data.type,
    callerName: parsed.data.caller_name,
    callerAvatar: parsed.data.caller_avatar,
    chatId: parsed.data.chat_id,
    roomId: parsed.data.room_id,
    status: 'ringing',
  }).returning();

  broadcast('call', call.id, call);
  res.status(201).json({ success: true, data: call });
});

// ── Zone membership writes ────────────────────────────────────────────────────

writesRouter.post('/members/zone-switch', requireAuth, async (req, res) => {
  const auth = res.locals.auth;
  const schema = z.object({ zone_code: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [existing] = await db.select().from(profiles).where(eq(profiles.id, auth.userId)).limit(1);
  if (!existing) { notFound(res); return; }

  const raw =
    existing.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData)
      ? { ...(existing.rawData as Record<string, unknown>) }
      : {};
  raw.zone_code = parsed.data.zone_code;
  raw.zoneCode = parsed.data.zone_code;

  const [updatedProfile] = await db.update(profiles)
    .set({ rawData: raw, updatedAt: new Date().toISOString() })
    .where(eq(profiles.id, auth.userId))
    .returning();

  if (updatedProfile) broadcast('profile', auth.userId, updatedProfile);
  res.json({ success: true });
});

writesRouter.post('/members/zone-join', requireAuth, async (req, res) => {
  const auth = res.locals.auth;
  const schema = z.object({
    zone_id: z.string(),
    is_hq: z.boolean().default(false),
    user_email: z.string().optional(),
    user_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  if (parsed.data.is_hq) {
    await db.insert(hqMembers).values({
      id: `hq_${auth.userId}`,
      hqGroupId: parsed.data.zone_id,
      userId: auth.userId,
      userEmail: parsed.data.user_email,
      userName: parsed.data.user_name,
    }).onConflictDoNothing();
  } else {
    await db.insert(zoneMembers).values({
      id: `mem_${Date.now()}_${auth.userId}`,
      zoneId: parsed.data.zone_id,
      userId: auth.userId,
      role: 'member',
      status: 'active',
    }).onConflictDoNothing();
  }

  res.status(201).json({ success: true });
});

// ── Annotations & Notes ───────────────────────────────────────────────────────

writesRouter.patch('/songs/annotations/:songId', requireAuth, async (req, res) => {
  const { songId } = req.params;
  const auth = res.locals.auth;
  const schema = z.object({ data: z.record(z.unknown()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const existing = await db.select().from(mediaDoodles)
    .where(eq(mediaDoodles.songId, songId)).limit(1);

  const ownRecord = existing.find(r => r.userId === auth.userId);
  if (ownRecord) {
    const [updated] = await db.update(mediaDoodles)
      .set({ data: parsed.data.data, updatedAt: new Date() })
      .where(eq(mediaDoodles.id, ownRecord.id))
      .returning();
    res.json({ success: true, data: updated });
  } else {
    const [created] = await db.insert(mediaDoodles).values({
      id: crypto.randomUUID(),
      userId: auth.userId,
      songId,
      data: parsed.data.data,
    }).returning();
    res.json({ success: true, data: created });
  }
});

writesRouter.patch('/songs/notes/:songId', requireAuth, async (req, res) => {
  const { songId } = req.params;
  const auth = res.locals.auth;
  const schema = z.object({ notes: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const existing = await db.select().from(userSongNotes)
    .where(eq(userSongNotes.songId, songId)).limit(1);

  const ownRecord = existing.find(r => r.userId === auth.userId);
  if (ownRecord) {
    const [updated] = await db.update(userSongNotes)
      .set({ notes: parsed.data.notes, updatedAt: new Date() })
      .where(eq(userSongNotes.id, ownRecord.id))
      .returning();
    res.json({ success: true, data: updated });
  } else {
    const [created] = await db.insert(userSongNotes).values({
      id: crypto.randomUUID(),
      userId: auth.userId,
      songId,
      notes: parsed.data.notes,
    }).returning();
    res.json({ success: true, data: created });
  }
});

// ── OneSignal subscription ID ─────────────────────────────────────────────────

writesRouter.patch('/profiles/:userId/onesignal', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const auth = res.locals.auth;
  if (auth.userId !== userId) { forbidden(res); return; }

  const schema = z.object({ subscription_id: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: 'Invalid body' }); return; }

  const [existing] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!existing) { notFound(res); return; }

  const raw =
    existing.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData)
      ? { ...(existing.rawData as Record<string, unknown>) }
      : {};
  raw.onesignal_sub_id = parsed.data.subscription_id;

  const [updatedProfile] = await db.update(profiles)
    .set({ rawData: raw, updatedAt: new Date().toISOString() })
    .where(eq(profiles.id, userId))
    .returning();

  if (updatedProfile) broadcast('profile', userId, updatedProfile);
  res.json({ success: true });
});
