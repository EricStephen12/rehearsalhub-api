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

    let rows: any[] = [];
    if (isHqAdmin) {
      rows = await db.select().from(chats).limit(100);
    } else {
      rows = await db
        .select()
        .from(chats)
        .where(sql`${chats.participants}::jsonb ? ${userId}`);
    }

    res.json({ success: true, count: rows.length, data: rows.map(shapeChat) });
  } catch (err) {
    console.error('[chats/]', err);
    res.status(500).json({ success: false, error: 'Failed to load chats' });
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
    const senderName = req.body.senderName || 'Admin Support';
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
    };

    await db.insert(messages).values({
      id,
      chatId,
      senderId: auth.userId,
      senderName,
      text,
      type: 'text',
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
