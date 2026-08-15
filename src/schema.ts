import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';

export const masterSongs = pgTable('master_songs', {
  id: text('id').primaryKey(),
  title: text('title'),
  key: text('key'),
  tempo: text('tempo'),
  lyrics: text('lyrics'),
  writer: text('writer'),
  solfa: text('solfa'),
  category: text('category'),
  imageUrl: text('image_url'),
  audioFile: text('audio_file'),
  audioUrls: jsonb('audio_urls'),
  conductor: text('conductor'),
  leadSinger: text('lead_singer'),
  drummer: text('drummer'),
  bassGuitarist: text('bass_guitarist'),
  leadKeyboardist: text('lead_keyboardist'),
  categories: jsonb('categories'),
  customParts: jsonb('custom_parts'),
  publishedAt: timestamp('published_at'),
  publishedBy: text('published_by'),
  publishedByName: text('published_by_name'),
  updatedAt: timestamp('updated_at'),
  sourceType: text('source_type'),
  isHqOnly: boolean('is_hq_only'),
});

export const praiseNightSongs = pgTable('praise_night_songs', {
  id: text('id').primaryKey(),
  title: text('title'),
  key: text('key'),
  tempo: text('tempo'),
  lyrics: text('lyrics'),
  writer: text('writer'),
  category: text('category'),
  audioFile: text('audio_file'),
  audioUrls: jsonb('audio_urls'),
  conductor: text('conductor'),
  leadSinger: text('lead_singer'),
  drummer: text('drummer'),
  zoneId: text('zone_id'),
  praiseNightId: text('praise_night_id'),
  status: text('status'),
  isActive: boolean('is_active'),
  categories: jsonb('categories'),
  createdAt: text('created_at'),
  updatedAt: timestamp('updated_at'),
});

// ── Profiles (live Supabase shape — identity source of truth) ─────────────────

export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role'),
  hasHqAccess: boolean('has_hq_access'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at'),
  rawData: jsonb('raw_data'),
  kingschatId: text('kingschat_id'),
  profileCompleted: boolean('profile_completed'),
  updatedAt: text('updated_at'),
});

/** Additive — password hashes for existing profiles (does not replace profiles). */
export const authCredentials = pgTable('auth_credentials', {
  profileId: text('profile_id')
    .primaryKey()
    .references(() => profiles.id),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

/**
 * Additive — JWT refresh tokens.
 * Physical column remains `user_id` (live DB / older writers); value is always profiles.id.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    profileId: text('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    profileIdIdx: index('refresh_tokens_user_id_idx').on(table.profileId),
  }),
);

// ── Zones ─────────────────────────────────────────────────────────────────────

export const zones = pgTable('zones', {
  id: text('id').primaryKey(),
  name: text('name'),
  slug: text('slug'),
  region: text('region'),
  invitationCode: text('invitation_code'),
  themeColor: text('theme_color'),
  memberCount: integer('member_count').default(0),
  maxMembers: integer('max_members').default(20),
  subscriptionTier: text('subscription_tier').default('free'),
  subscriptionStatus: text('subscription_status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

/** Live Supabase shape — membership link only (not a profile). */
export const zoneMembers = pgTable('zone_members', {
  id: text('id').primaryKey(),
  zoneId: text('zone_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').default('member'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

/** Live Supabase shape — membership link only (not a profile). */
export const hqMembers = pgTable('hq_members', {
  id: text('id').primaryKey(),
  hqGroupId: text('hq_group_id').notNull(),
  userId: text('user_id').notNull(),
  userEmail: text('user_email'),
  userName: text('user_name'),
  role: text('role').default('member'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  joinedAt: timestamp('joined_at'),
  rawData: jsonb('raw_data'),
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

export const individualSubscriptions = pgTable('individual_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status').default('inactive'),
  expiresAt: text('expires_at'),
  plan: text('plan'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

// ── Songs & Praise Nights ─────────────────────────────────────────────────────

export const praiseNights = pgTable('praise_nights', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  scope: text('scope'),
  zoneId: text('zone_id'),
  category: text('category'),
  location: text('location'),
  bannerImage: text('banner_image'),
  songs: jsonb('songs'),
  rawData: jsonb('raw_data'),
});

// ── Chats & Messages ──────────────────────────────────────────────────────────

/** Matches Supabase chats_v2 from firebase-to-supabase migrate-from-export.js */
export const chatsV2 = pgTable('chats_v2', {
  id: text('id').primaryKey(),
  type: text('type'),
  createdBy: text('created_by'),
  participants: jsonb('participants'),
  participantDetails: jsonb('participant_details'),
  unreadCount: jsonb('unread_count'),
  rawData: jsonb('raw_data'),
});

/** Matches Supabase messages_v2 from migrate-from-export.js */
export const messagesV2 = pgTable('messages_v2', {
  id: text('id').primaryKey(),
  text: text('text'),
  type: text('type').default('text'),
  chatId: text('chat_id').notNull(),
  edited: boolean('edited'),
  status: text('status'),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name'),
  reactions: jsonb('reactions'),
  rawData: jsonb('raw_data'),
});

// ── Calls ─────────────────────────────────────────────────────────────────────

export const callsV2 = pgTable('calls_v2', {
  id: text('id').primaryKey(),
  callerId: text('caller_id').notNull(),
  callerName: text('caller_name'),
  callerAvatar: text('caller_avatar'),
  receiverId: text('receiver_id').notNull(),
  type: text('type').default('voice'),
  status: text('status').default('ringing'),
  chatId: text('chat_id'),
  roomId: text('room_id'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Schedule (live table is schedule_programs) ────────────────────────────────

export const schedulePrograms = pgTable('schedule_programs', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  createdAt: timestamp('created_at'),
  rawData: jsonb('raw_data'),
  zoneId: text('zone_id'),
  days: jsonb('days'),
  weeks: jsonb('weeks'),
  newSongs: jsonb('new_songs'),
  isArchived: boolean('is_archived'),
  dailySchedules: jsonb('daily_schedules'),
  updatedAt: timestamp('updated_at'),
});

/** @deprecated Use schedulePrograms — live DB has no public.schedule table. */
export const schedule = schedulePrograms;

// ── Activity Logs ─────────────────────────────────────────────────────────────

/** Live shape: id + raw_data only. */
export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

// ── Categories ────────────────────────────────────────────────────────────────

/** Live shape: id + raw_data only. */
export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

// ── Submitted Songs ───────────────────────────────────────────────────────────

export const submittedSongs = pgTable('submitted_songs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  title: text('title'),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at'),
  rawData: jsonb('raw_data'),
  zoneId: text('zone_id'),
  submittedBy: text('submitted_by'),
  submittedByEmail: text('submitted_by_email'),
});

// ── User Song Notes & Doodles ─────────────────────────────────────────────────

export const userSongNotes = pgTable('user_song_notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  songId: text('song_id').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

export const mediaDoodles = pgTable('media_doodles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  songId: text('song_id').notNull(),
  data: jsonb('data'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

// ── App Updates ───────────────────────────────────────────────────────────────

export const appUpdates = pgTable('app_updates', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  title: text('title'),
  description: text('description'),
  isForced: boolean('is_forced').default(false),
  platform: text('platform'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Tables already populated in Supabase (Firebase export migration) ──────────
// Column shapes match migrate-from-export.js / raw fallback tables. Do not re-migrate.

export const userFavorites = pgTable('user_favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  songId: text('song_id'),
  rawData: jsonb('raw_data'),
});

export const userPlaylists = pgTable('user_playlists', {
  id: text('id').primaryKey(),
  title: text('title'),
  userId: text('user_id'),
  songIds: jsonb('song_ids'),
  isPublic: boolean('is_public'),
  rawData: jsonb('raw_data'),
});

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  type: text('type'),
  title: text('title'),
  message: text('message'),
  zoneId: text('zone_id'),
  isRead: boolean('is_read'),
  category: text('category'),
  priority: text('priority'),
  senderId: text('sender_id'),
  actionUrl: text('action_url'),
  createdAt: text('created_at'),
  targetUserId: text('target_user_id'),
  targetAudience: text('target_audience'),
  rawData: jsonb('raw_data'),
});

export const subgroups = pgTable('subgroups', {
  id: text('id').primaryKey(),
  name: text('name'),
  zoneId: text('zone_id'),
  description: text('description'),
  rawData: jsonb('raw_data'),
});

export const subgroupSongs = pgTable('subgroup_songs', {
  id: text('id').primaryKey(),
  title: text('title'),
  key: text('key'),
  tempo: text('tempo'),
  zoneId: text('zone_id'),
  status: text('status'),
  rawData: jsonb('raw_data'),
});

export const subgroupPraiseNights = pgTable('subgroup_praise_nights', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  zoneId: text('zone_id'),
  subGroupId: text('sub_group_id'),
  subGroupName: text('sub_group_name'),
  songIds: jsonb('song_ids'),
  rawData: jsonb('raw_data'),
});

export const zoneSongs = pgTable('zone_songs', {
  id: text('id').primaryKey(),
  title: text('title'),
  key: text('key'),
  tempo: text('tempo'),
  zoneId: text('zone_id'),
  status: text('status'),
  audioFile: text('audio_file'),
  categories: jsonb('categories'),
  rawData: jsonb('raw_data'),
});

export const attendance = pgTable('attendance', {
  id: text('id').primaryKey(),
  status: text('status'),
  userId: text('user_id'),
  zoneId: text('zone_id'),
  userName: text('user_name'),
  eventName: text('event_name'),
  qrCode: text('qr_code'),
  checkInTime: text('check_in_time'),
  recordedByAdminId: text('recorded_by_admin_id'),
  rawData: jsonb('raw_data'),
});

/** Raw-only tables from REMAINING_COLLECTIONS fallback */
export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const userGroups = pgTable('user_groups', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const userNotifications = pgTable('user_notifications', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const zonePraiseNights = pgTable('zone_praise_nights', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});
