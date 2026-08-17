import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { chats, messages } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function shapeChat(row: typeof chats.$inferSelect) {
  const merged = mergeRawRow(row);
  const participants = Array.isArray(merged.participants)
    ? merged.participants
    : Array.isArray(row.participants)
      ? row.participants
      : [];
  return {
    ...merged,
    id: row.id,
    type: row.type ?? (merged.type as string | undefined),
    participants,
    memberIds: participants,
    participantDetails: merged.participantDetails || row.participantDetails || {},
    unreadCount: merged.unreadCount || row.unreadCount || {},
  };
}

// GET /chats — chats where the caller is a member (Supabase participants jsonb)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db
      .select()
      .from(chats)
      .where(sql`${chats.participants}::jsonb ? ${userId}`);
    res.json({ success: true, data: rows.map(shapeChat) });
  } catch (err) {
    console.error('[chats/]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const messageRows = await db.select().from(messages).where(eq(messages.chatId, req.params.chatId));
    res.json({
      success: true,
      data: messageRows.map((m) => {
        const merged = mergeRawRow(m);
        return {
          ...merged,
          id: m.id,
          chatId: m.chatId,
          text: m.text ?? (merged.text as string | undefined) ?? (merged.content as string | undefined),
          content: (merged.content as string | undefined) ?? m.text,
          type: m.type,
          senderId: m.senderId,
        };
      }),
    });
  } catch (err) {
    console.error('[chats/:id/messages]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

router.get('/:chatId', requireAuth, async (req, res) => {
  try {
    const [chat] = await db.select().from(chats).where(eq(chats.id, req.params.chatId)).limit(1);
    if (!chat) { res.status(404).json({ success: false, error: 'Chat not found' }); return; }
    res.json({ success: true, data: shapeChat(chat) });
  } catch (err) {
    console.error('[chats/:id]', err);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

export default router;
