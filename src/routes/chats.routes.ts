import { Router } from 'express';
import { eq, sql, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { chats, messages, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';
import { broadcast } from '../ws/wsServer';

const router = Router();

function shapeChat(row: typeof chats.$inferSelect) {
  const merged = mergeRawRow(row);
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};
  const participants = Array.isArray(merged.participants)
    ? merged.participants
    : Array.isArray(row.participants)
      ? row.participants
      : [];

  let lastMessageText = 'No messages yet';
  const lm = raw.lastMessage || raw.last_message || merged.lastMessage || merged.last_message;
  if (typeof lm === 'string') {
    lastMessageText = lm;
  } else if (lm && typeof lm === 'object' && typeof lm.text === 'string') {
    lastMessageText = lm.text;
  }

  let lastTimestamp = raw.lastTimestamp || raw.updatedAt || raw.createdAt || new Date().toISOString();
  if (lm && typeof lm === 'object' && lm.timestamp) {
    lastTimestamp = lm.timestamp;
  }

  return {
    ...merged,
    id: row.id,
    type: row.type ?? (merged.type as string | undefined) ?? 'direct',
    name: raw.name || raw.userName || raw.user_name || merged.name || 'Support Thread',
    participants,
    memberIds: participants,
    participantDetails: merged.participantDetails || row.participantDetails || {},
    unreadCount: merged.unreadCount || row.unreadCount || 0,
    lastMessage: lastMessageText,
    lastTimestamp,
  };
}

// GET /chats — chats for user or all chats for admin
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const userId = auth.userId as string;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';

    const allRows = await db.select().from(chats).limit(500);

    let rows: (typeof chats.$inferSelect)[] = [];
    if (isHqAdmin) {
      rows = allRows;
    } else {
      rows = allRows.filter((r) => {
        const raw = (r.rawData && typeof r.rawData === 'object') ? (r.rawData as Record<string, any>) : {};
        const participants = Array.isArray(r.participants)
          ? r.participants
          : Array.isArray(raw.participants)
            ? raw.participants
            : Array.isArray(raw.memberIds)
              ? raw.memberIds
              : typeof r.participants === 'object' && r.participants !== null
                ? Object.keys(r.participants)
                : typeof raw.participants === 'object' && raw.participants !== null
                  ? Object.keys(raw.participants)
                  : [];
        return (
          participants.map(String).includes(userId) ||
          r.createdBy === userId ||
          raw.createdBy === userId ||
          raw.created_by === userId
        );
      });
    }

    res.json({ success: true, count: rows.length, data: rows.map(shapeChat) });
  } catch (err) {
    console.error('[chats/]', err);
    res.status(500).json({ success: false, error: 'Failed to load chats' });
  }
});

// GET /chats/:chatId
router.get('/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const [row] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!row) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }
    res.json({ success: true, data: shapeChat(row) });
  } catch (err) {
    console.error('[chats/:id]', err);
    res.status(500).json({ success: false, error: 'Failed to load chat' });
  }
});

// POST /chats — Create new chat
router.post('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const { name, type = 'direct', member_ids = [], participants: inputParticipants, zone_id } = req.body;

    const rawList = Array.isArray(member_ids) && member_ids.length > 0
      ? member_ids
      : Array.isArray(inputParticipants)
        ? inputParticipants
        : [];

    const participants = rawList.includes(auth.userId)
      ? rawList
      : [...rawList, auth.userId];

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const rawData = {
      id,
      name,
      type,
      zoneId: zone_id,
      participants,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    };

    const [chat] = await db.insert(chats).values({
      id,
      type,
      createdBy: auth.userId,
      participants,
      participantDetails: {},
      unreadCount: {},
      rawData,
    }).returning();

    broadcast('chat', chat.id, shapeChat(chat));
    res.status(201).json({ success: true, data: shapeChat(chat) });
  } catch (err) {
    console.error('[chats:post]', err);
    res.status(500).json({ success: false, error: 'Failed to create chat' });
  }
});

// PATCH /chats/:chatId
router.patch('/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const [existing] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }

    const prevRaw = (existing.rawData && typeof existing.rawData === 'object')
      ? (existing.rawData as Record<string, any>)
      : {};

    const { name, last_message, lastMessage, last_message_at, member_ids, participants } = req.body;

    const nextParticipants = Array.isArray(member_ids)
      ? member_ids
      : Array.isArray(participants)
        ? participants
        : existing.participants;

    const nextRaw = {
      ...prevRaw,
      ...(name !== undefined ? { name } : {}),
      ...(last_message !== undefined || lastMessage !== undefined ? { lastMessage: last_message || lastMessage } : {}),
      ...(last_message_at !== undefined ? { lastTimestamp: last_message_at } : {}),
      ...(nextParticipants ? { participants: nextParticipants } : {}),
      updatedAt: new Date().toISOString(),
    };

    const [updated] = await db.update(chats)
      .set({
        ...(nextParticipants ? { participants: nextParticipants } : {}),
        rawData: nextRaw,
      })
      .where(eq(chats.id, chatId))
      .returning();

    broadcast('chat', chatId, shapeChat(updated));
    res.json({ success: true, data: shapeChat(updated) });
  } catch (err) {
    console.error('[chats:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update chat' });
  }
});

// GET /chats/:chatId/messages
router.get('/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const messageRows = await db.select().from(messages).where(eq(messages.chatId, req.params.chatId));
    const data = messageRows.map((m) => {
      const merged = mergeRawRow(m);
      const raw = (m.rawData && typeof m.rawData === 'object') ? (m.rawData as Record<string, any>) : {};
      return {
        ...merged,
        id: m.id,
        chatId: m.chatId,
        text: m.text ?? (merged.text as string | undefined) ?? (merged.content as string | undefined) ?? '',
        content: (merged.content as string | undefined) ?? m.text,
        type: m.type || 'text',
        senderId: m.senderId || raw.senderId || 'admin',
        senderName: raw.senderName || raw.sender_name || 'Admin Support',
        senderType: raw.senderType || (raw.senderId === 'admin' ? 'admin' : 'user'),
        timestamp: (raw.timestamp as string) || (raw.createdAt as string) || new Date().toISOString(),
      };
    });

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[chats/:id/messages]', err);
    res.status(500).json({ success: false, error: 'Failed to load messages' });
  }
});

// POST /chats/:chatId/messages — Send reply
router.post('/:chatId/messages', requireAuth, async (req: any, res) => {
  try {
    const { chatId } = req.params;
    const auth = res.locals.auth;
    const text = req.body.text?.trim() || req.body.content?.trim();
    if (!text) {
      res.status(400).json({ success: false, error: 'Message text is required' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const senderName = req.body.senderName || req.body.sender_name || 'User';
    const isSenderAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';

    const rawData = {
      id,
      chatId,
      text,
      senderId: auth.userId,
      senderName,
      senderType: isSenderAdmin ? 'admin' : 'user',
      timestamp: now,
      createdAt: now,
      imageUrl: req.body.imageUrl || req.body.media_url,
      attachment: req.body.attachment,
      replyTo: req.body.replyTo || req.body.reply_to,
    };

    await db.insert(messages).values({
      id,
      chatId,
      senderId: auth.userId,
      senderName,
      text,
      type: req.body.type || 'text',
      rawData,
    });

    // Update last message in chat
    const [existingChat] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (existingChat) {
      const chatRaw = (existingChat.rawData && typeof existingChat.rawData === 'object') ? (existingChat.rawData as Record<string, any>) : {};
      await db.update(chats).set({
        rawData: { ...chatRaw, lastMessage: text, lastTimestamp: now, updatedAt: now },
      }).where(eq(chats.id, chatId));
    }

    broadcast('chat', chatId, rawData);
    res.status(201).json({ success: true, data: rawData });
  } catch (err) {
    console.error('[chats/:id/messages:post]', err);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

export default router;
