import { Router } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { supportTickets, supportMessages, profiles } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';
import { broadcast } from '../ws/wsServer';

const router = Router();

// Ensure support tables exist in PostgreSQL database
async function ensureTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id text PRIMARY KEY,
        user_id text,
        user_name text,
        user_email text,
        subject text,
        category text DEFAULT 'general',
        status text DEFAULT 'open',
        priority text DEFAULT 'normal',
        zone_id text,
        last_message text,
        last_timestamp timestamptz DEFAULT NOW(),
        unread_by_admin integer DEFAULT 0,
        unread_by_user integer DEFAULT 0,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        raw_data jsonb
      );

      CREATE TABLE IF NOT EXISTS support_messages (
        id text PRIMARY KEY,
        ticket_id text NOT NULL,
        sender_id text NOT NULL,
        sender_name text,
        sender_type text DEFAULT 'user',
        message text NOT NULL,
        attachments jsonb,
        created_at timestamptz DEFAULT NOW(),
        raw_data jsonb
      );
    `);
  } catch (err) {
    console.warn('[support:init]', err);
  }
}
ensureTables();

function shapeTicket(row: typeof supportTickets.$inferSelect) {
  const merged = mergeRawRow(row);
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};

  let lastMessageText = row.lastMessage || raw.lastMessage || raw.last_message || 'No messages yet';
  if (typeof lastMessageText === 'object' && lastMessageText && 'text' in (lastMessageText as any)) {
    lastMessageText = (lastMessageText as any).text;
  }

  let lastTimestamp = row.lastTimestamp ? new Date(row.lastTimestamp).toISOString() : (raw.lastTimestamp || raw.updatedAt || new Date().toISOString());

  return {
    ...merged,
    id: row.id,
    ticketId: row.id,
    userId: row.userId || raw.userId || 'singer',
    userName: row.userName || raw.userName || raw.user_name || 'Member',
    userEmail: row.userEmail || raw.userEmail || '',
    subject: row.subject || raw.subject || 'Support Inquiry',
    category: row.category || raw.category || 'general',
    status: row.status || raw.status || 'open',
    priority: row.priority || raw.priority || 'normal',
    zoneId: row.zoneId || raw.zoneId || null,
    lastMessage: typeof lastMessageText === 'string' ? lastMessageText : 'No messages yet',
    lastTimestamp,
    unreadByAdmin: row.unreadByAdmin || 0,
    unreadByUser: row.unreadByUser || 0,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
}

/** GET /support — List support tickets */
router.get('/', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';

    const { zoneId } = req.query;
    const effectiveZoneId = (zoneId && zoneId !== 'all') ? String(zoneId) : null;

    let rows;
    if (isHqAdmin) {
      if (effectiveZoneId) {
        const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
        const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

        rows = await db.select().from(supportTickets).where(
          sql`lower(replace(${supportTickets.zoneId}, '-', '')) = ${withoutHyphen} OR 
              lower(${supportTickets.zoneId}) = ${withHyphen}`
        ).orderBy(desc(supportTickets.lastTimestamp)).limit(150);
      } else {
        rows = await db.select().from(supportTickets).orderBy(desc(supportTickets.lastTimestamp)).limit(150);
      }
    } else {
      rows = await db.select().from(supportTickets).where(eq(supportTickets.userId, auth.userId)).orderBy(desc(supportTickets.lastTimestamp)).limit(50);
    }

    res.json({ success: true, count: rows.length, data: rows.map(shapeTicket) });
  } catch (err) {
    console.error('[support:list]', err);
    res.status(500).json({ success: false, error: 'Failed to load support tickets' });
  }
});

/** GET /support/:ticketId — Get single ticket */
router.get('/:ticketId', requireAuth, async (req, res) => {
  try {
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.ticketId)).limit(1);
    if (!ticket) {
      res.status(404).json({ success: false, error: 'Support ticket not found' });
      return;
    }
    res.json({ success: true, data: shapeTicket(ticket) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load support ticket' });
  }
});

/** GET /support/:ticketId/messages — Get ticket messages */
router.get('/:ticketId/messages', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const messageRows = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, ticketId))
      .orderBy(supportMessages.createdAt);

    const data = messageRows.map((m) => {
      const merged = mergeRawRow(m);
      const raw = (m.rawData && typeof m.rawData === 'object') ? (m.rawData as Record<string, any>) : {};
      return {
        ...merged,
        id: m.id,
        ticketId: m.ticketId,
        senderId: m.senderId,
        senderName: m.senderName || raw.senderName || 'Support User',
        senderType: m.senderType || raw.senderType || 'user',
        text: m.message,
        message: m.message,
        timestamp: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
      };
    });

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[support:messages:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load support messages' });
  }
});

/** POST /support — Create new support ticket */
router.post('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { subject, category = 'general', priority = 'normal', message, initialMessage } = req.body;
    const firstText = message || initialMessage || subject || 'Need assistance with rehearsal hub';

    const ticketId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date();

    // Fetch user profile name
    const [userProf] = await db.select().from(profiles).where(eq(profiles.id, auth.userId)).limit(1);
    const rawP = (userProf?.rawData && typeof userProf.rawData === 'object') ? (userProf.rawData as Record<string, any>) : {};
    const userName = [userProf?.firstName, userProf?.lastName].filter(Boolean).join(' ') || rawP.first_name || auth.email || 'Singer';
    const userEmail = userProf?.email || rawP.email || auth.email || '';

    const ticketRaw = {
      id: ticketId,
      userId: auth.userId,
      userName,
      userEmail,
      subject: subject || 'Support Request',
      category,
      status: 'open',
      priority,
      zoneId: auth.zoneId || null,
      lastMessage: firstText,
      lastTimestamp: now.toISOString(),
      createdAt: now.toISOString(),
    };

    await db.insert(supportTickets).values({
      id: ticketId,
      userId: auth.userId,
      userName,
      userEmail,
      subject: subject || 'Support Request',
      category,
      status: 'open',
      priority,
      zoneId: auth.zoneId || null,
      lastMessage: firstText,
      lastTimestamp: now,
      unreadByAdmin: 1,
      createdAt: now,
      updatedAt: now,
      rawData: ticketRaw,
    });

    // Create initial message
    await db.insert(supportMessages).values({
      id: messageId,
      ticketId,
      senderId: auth.userId,
      senderName: userName,
      senderType: 'user',
      message: firstText,
      createdAt: now,
      rawData: { id: messageId, ticketId, senderId: auth.userId, senderName: userName, text: firstText, createdAt: now.toISOString() },
    });

    broadcast('support', ticketId, { type: 'new_ticket', ticket: ticketRaw });
    res.status(201).json({ success: true, data: ticketRaw });
  } catch (err) {
    console.error('[support:create]', err);
    res.status(500).json({ success: false, error: 'Failed to create support ticket' });
  }
});

/** POST /support/:ticketId/messages — Reply to support ticket */
router.post('/:ticketId/messages', requireAuth, async (req: any, res) => {
  try {
    const { ticketId } = req.params;
    const auth = res.locals.auth;
    const text = req.body.text?.trim() || req.body.message?.trim() || req.body.content?.trim();

    if (!text) {
      res.status(400).json({ success: false, error: 'Message text is required' });
      return;
    }

    const messageId = crypto.randomUUID();
    const now = new Date();
    const isAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    const senderType = isAdmin ? 'admin' : 'user';
    const senderName = req.body.senderName || (isAdmin ? 'HQ Support Admin' : 'Member');

    const msgPayload = {
      id: messageId,
      ticketId,
      senderId: auth.userId,
      senderName,
      senderType,
      text,
      message: text,
      timestamp: now.toISOString(),
      createdAt: now.toISOString(),
    };

    await db.insert(supportMessages).values({
      id: messageId,
      ticketId,
      senderId: auth.userId,
      senderName,
      senderType,
      message: text,
      createdAt: now,
      rawData: msgPayload,
    });

    // Update ticket last_message & timestamps
    await db.update(supportTickets).set({
      lastMessage: text,
      lastTimestamp: now,
      updatedAt: now,
      status: isAdmin ? 'in_progress' : 'open',
    }).where(eq(supportTickets.id, ticketId));

    broadcast('support', ticketId, msgPayload);
    res.status(201).json({ success: true, data: msgPayload });
  } catch (err) {
    console.error('[support:reply]', err);
    res.status(500).json({ success: false, error: 'Failed to send support reply' });
  }
});

/** PATCH /support/:ticketId/status — Update ticket status */
router.patch('/:ticketId/status', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }

    await db.update(supportTickets).set({
      status,
      updatedAt: new Date(),
    }).where(eq(supportTickets.id, ticketId));

    res.json({ success: true, message: `Ticket status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update ticket status' });
  }
});

/** DELETE /support/:ticketId — Delete support ticket */
router.delete('/:ticketId', requireAuth, async (req, res) => {
  try {
    const auth = res.locals.auth;
    if (auth.role !== 'hq_admin' && auth.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const { ticketId } = req.params;
    await db.delete(supportMessages).where(eq(supportMessages.ticketId, ticketId));
    await db.delete(supportTickets).where(eq(supportTickets.id, ticketId));

    res.json({ success: true, message: 'Support ticket deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete support ticket' });
  }
});

export default router;
