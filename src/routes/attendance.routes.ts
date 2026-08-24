import { Router } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db';
import { attendance, profiles, settings } from '../schema';
import { requireAuth } from '../auth/auth.middleware';
import { mergeRawRow } from '../lib/rawRow';

const router = Router();

function shapeAttendance(row: any) {
  const merged = mergeRawRow(row);
  const raw = (row.rawData && typeof row.rawData === 'object') ? (row.rawData as Record<string, any>) : {};

  const id = String(row.id);
  const userId = row.userId || raw.userId || raw.user_id || '';
  const userName = row.userName || raw.userName || raw.user_name || raw.name || 'Singer';
  const eventName = row.eventName || raw.eventName || raw.event_name || 'Rehearsal';
  const status = row.status || raw.status || 'present';
  const zoneId = row.zoneId || raw.zoneId || raw.zone_id || 'general';
  const checkInTime = row.checkInTime || raw.checkInTime || raw.check_in_time || raw.timestamp || raw.createdAt || raw.created_at || new Date().toISOString();
  const checkOutTime = raw.checkOutTime || raw.check_out_time || null;
  const dateString = raw.dateString || raw.date_string || (checkInTime ? new Date(checkInTime).toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA'));
  const qrCode = row.qrCode || raw.qrCode || raw.qr_code || '';

  return {
    ...merged,
    id,
    userId,
    user_id: userId,
    userName,
    user_name: userName,
    eventName,
    event_name: eventName,
    status,
    zoneId,
    zone_id: zoneId,
    checkInTime,
    check_in_time: checkInTime,
    checkOutTime,
    check_out_time: checkOutTime,
    dateString,
    date_string: dateString,
    createdAt: checkInTime,
    created_at: checkInTime,
    timestamp: checkInTime,
    qrCode,
    qr_code: qrCode,
    rawData: raw,
  };
}

/** GET /attendance — Admin list attendance with zone and date filtering */
router.get('/', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { zoneId, date } = req.query;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin';
    const effectiveZoneId = (zoneId && zoneId !== 'all') ? String(zoneId) : (!isHqAdmin ? (auth.zoneId as string | null) : null);

    let rows: any[] = [];
    if (effectiveZoneId && effectiveZoneId !== 'all') {
      const withoutHyphen = effectiveZoneId.replace(/-/g, '').toLowerCase();
      const withHyphen = effectiveZoneId.includes('-') ? effectiveZoneId.toLowerCase() : effectiveZoneId.toLowerCase().replace(/^zone(\d+)$/, 'zone-$1');

      rows = await db.select().from(attendance).where(
        sql`lower(replace(${attendance.zoneId}, '-', '')) = ${withoutHyphen} OR lower(${attendance.zoneId}) = ${withHyphen}`
      );
    } else {
      rows = await db.select().from(attendance);
    }

    let data = rows.map(shapeAttendance);

    if (date) {
      data = data.filter((r) => r.dateString === date || r.checkInTime?.startsWith(String(date)));
    }

    data.sort((a, b) => String(b.checkInTime ?? '').localeCompare(String(a.checkInTime ?? '')));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[attendance:get]', err);
    res.status(500).json({ success: false, error: 'Failed to load attendance records' });
  }
});

/** GET /attendance/mine — Current user's records */
router.get('/mine', requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.auth.userId as string;
    const rows = await db.select().from(attendance).where(eq(attendance.userId, userId));
    const data = rows.map(shapeAttendance).sort((a, b) => String(b.checkInTime ?? '').localeCompare(String(a.checkInTime ?? '')));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[attendance/mine]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch personal attendance' });
  }
});

/** POST /attendance or POST /attendance/check-in — Singer or Admin check in */
const handleCheckIn = async (req: any, res: any) => {
  try {
    const auth = res.locals.auth;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const dateString = new Date().toLocaleDateString('en-CA');

    const targetUserId = req.body.userId || auth.userId;
    const [userProfile] = await db.select().from(profiles).where(eq(profiles.id, targetUserId)).limit(1);
    const rawProfile = (userProfile?.rawData && typeof userProfile.rawData === 'object') ? (userProfile.rawData as Record<string, any>) : {};

    const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ') || (rawProfile.first_name ? `${rawProfile.first_name} ${rawProfile.last_name || ''}` : '') || req.body.userName || auth.email;
    const zoneId = req.body.zoneId || rawProfile.zone_code || rawProfile.zoneId || auth.zoneId || 'general';
    const eventName = req.body.eventName || 'Rehearsal';

    const rawData = {
      id,
      userId: targetUserId,
      user_id: targetUserId,
      userName: fullName,
      user_name: fullName,
      eventName,
      event_name: eventName,
      status: 'present',
      zoneId,
      zone_id: zoneId,
      checkInTime: now,
      check_in_time: now,
      dateString,
      date_string: dateString,
      latitude: req.body.latitude || null,
      longitude: req.body.longitude || null,
      recordedBy: auth.userId,
      createdAt: now,
    };

    const [inserted] = await db.insert(attendance).values({
      id,
      userId: targetUserId,
      userName: fullName,
      eventName,
      status: 'present',
      zoneId,
      checkInTime: now,
      recordedByAdminId: auth.userId,
      rawData,
    }).returning();

    res.status(201).json({ success: true, message: 'Checked in successfully', data: shapeAttendance(inserted) });
  } catch (err: any) {
    console.error('[attendance:check-in]', err);
    res.status(500).json({ success: false, error: err?.message || 'Check-in failed' });
  }
};

router.post('/check-in', requireAuth, handleCheckIn);
router.post('/', requireAuth, handleCheckIn);

/** POST /attendance/check-out — Clock out */
router.post('/check-out', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const { attendanceId } = req.body;
    const now = new Date().toISOString();

    let existing: any = null;
    if (attendanceId) {
      const [r] = await db.select().from(attendance).where(eq(attendance.id, attendanceId)).limit(1);
      existing = r;
    } else {
      // Find latest check-in for user today
      const today = new Date().toLocaleDateString('en-CA');
      const rows = await db.select().from(attendance).where(eq(attendance.userId, auth.userId));
      existing = rows.find((r: any) => {
        const shaped = shapeAttendance(r);
        return shaped.dateString === today && !shaped.checkOutTime;
      });
    }

    if (!existing) {
      return res.status(404).json({ success: false, error: 'No active check-in session found to check out from.' });
    }

    const raw = (existing.rawData as Record<string, any>) || {};
    const updatedRaw = {
      ...raw,
      checkOutTime: now,
      check_out_time: now,
      status: 'completed',
    };

    const [updated] = await db.update(attendance)
      .set({ status: 'completed', rawData: updatedRaw })
      .where(eq(attendance.id, existing.id))
      .returning();

    res.json({ success: true, message: 'Checked out successfully', data: shapeAttendance(updated) });
  } catch (err: any) {
    console.error('[attendance:check-out]', err);
    res.status(500).json({ success: false, error: err?.message || 'Check-out failed' });
  }
});

/** POST /attendance/manual — Admin adds manual entry */
router.post('/manual', requireAuth, async (req: any, res) => {
  try {
    const auth = res.locals.auth;
    const isHqAdmin = auth.role === 'hq_admin' || auth.role === 'admin' || auth.role === 'zone_admin';
    if (!isHqAdmin) {
      return res.status(403).json({ success: false, error: 'Only admins can record manual attendance' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userName = req.body.userName?.trim() || req.body.user_name?.trim() || 'Manual Attendee';
    const eventName = req.body.eventName?.trim() || req.body.event_name?.trim() || 'Rehearsal';
    const zoneId = req.body.zoneId || auth.zoneId || 'general';
    const status = req.body.status || 'present';
    const dateString = req.body.dateString || new Date().toLocaleDateString('en-CA');

    const rawData = {
      id,
      userId: req.body.userId || `manual-${crypto.randomUUID().slice(0, 8)}`,
      userName,
      user_name: userName,
      eventName,
      event_name: eventName,
      status,
      zoneId,
      zone_id: zoneId,
      checkInTime: status === 'present' ? now : null,
      check_in_time: status === 'present' ? now : null,
      dateString,
      date_string: dateString,
      manual: true,
      recordedBy: auth.userId,
      createdAt: now,
    };

    const [inserted] = await db.insert(attendance).values({
      id,
      userId: rawData.userId,
      userName,
      eventName,
      status,
      zoneId,
      checkInTime: status === 'present' ? now : null,
      recordedByAdminId: auth.userId,
      rawData,
    }).returning();

    res.status(201).json({ success: true, message: 'Manual attendance recorded', data: shapeAttendance(inserted) });
  } catch (err: any) {
    console.error('[attendance:manual]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to save attendance' });
  }
});

/** PATCH /attendance/:id — Admin update attendance record */
router.patch('/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { eventName, event_name, status, userName, user_name, checkInTime, check_in_time, checkOutTime, check_out_time, isArchived, is_archived } = req.body;

    const [existing] = await db.select().from(attendance).where(eq(attendance.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Attendance record not found' });
    }

    const raw = (existing.rawData as Record<string, any>) || {};
    const updatedEvent = eventName || event_name || raw.eventName || existing.eventName;
    const updatedUser = userName || user_name || raw.userName || existing.userName;
    const updatedStatus = status !== undefined ? status : (raw.status || existing.status);
    const updatedCheckIn = checkInTime || check_in_time || raw.checkInTime || existing.checkInTime;
    const updatedCheckOut = checkOutTime !== undefined ? checkOutTime : (check_out_time !== undefined ? check_out_time : (raw.checkOutTime || null));
    const updatedArchived = isArchived !== undefined ? isArchived : (is_archived !== undefined ? is_archived : raw.isArchived);

    const updatedRaw = {
      ...raw,
      eventName: updatedEvent,
      event_name: updatedEvent,
      userName: updatedUser,
      user_name: updatedUser,
      status: updatedStatus,
      checkInTime: updatedCheckIn,
      check_in_time: updatedCheckIn,
      checkOutTime: updatedCheckOut,
      check_out_time: updatedCheckOut,
      isArchived: updatedArchived,
      is_archived: updatedArchived,
      updatedAt: new Date().toISOString(),
    };

    const [updated] = await db.update(attendance)
      .set({
        eventName: updatedEvent,
        userName: updatedUser,
        status: updatedStatus,
        rawData: updatedRaw,
      })
      .where(eq(attendance.id, id))
      .returning();

    res.json({ success: true, message: 'Attendance record updated', data: shapeAttendance(updated) });
  } catch (err) {
    console.error('[attendance:patch]', err);
    res.status(500).json({ success: false, error: 'Failed to update attendance record' });
  }
});

/** DELETE /attendance/:id — Admin delete record */
router.delete('/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    await db.delete(attendance).where(eq(attendance.id, id));
    res.json({ success: true, message: 'Attendance record deleted' });
  } catch (err) {
    console.error('[attendance:delete]', err);
    res.status(500).json({ success: false, error: 'Failed to delete attendance record' });
  }
});

export default router;

