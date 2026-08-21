import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';

// ============================================================================
// 1. SONGS & REPERTOIRE (CORE DOMAIN)
// ============================================================================

/**
 * MINISTERED SONGS (formerly master_songs)
 * The global ministry catalog of all ministered songs across Loveworld Singers.
 * Fetched by HQ and global members on the "All Ministered Songs" screens.
 */
export const ministeredSongs = pgTable('ministered_songs', {
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
  rawData: jsonb('raw_data'),
});

/** Backward-compatibility alias */
export const masterSongs = ministeredSongs;

/**
 * SONGS (formerly praise_night_songs)
 * The Main Repertoire / Rehearsal Songs table for all songs prepared and rehearsed.
 */
export const songs = pgTable('songs', {
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
  rawData: jsonb('raw_data'),
});

/** Backward-compatibility alias */
export const praiseNightSongs = songs;

/**
 * ZONE SONGS
 * Repertoire specific to individual local zones (non-HQ).
 */
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

/**
 * SUBGROUP SONGS
 * Repertoire assigned to sub-choirs (e.g. Sopranos, Altos, Instrumentalists).
 */
export const subgroupSongs = pgTable('subgroup_songs', {
  id: text('id').primaryKey(),
  title: text('title'),
  key: text('key'),
  tempo: text('tempo'),
  zoneId: text('zone_id'),
  status: text('status'),
  rawData: jsonb('raw_data'),
});

/**
 * PROGRAMS (formerly praise_nights)
 * Event and rehearsal program metadata (e.g. Praise Night 27, Midweek, Sunday Special, etc.).
 */
export const programs = pgTable('programs', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  scope: text('scope'),
  zoneId: text('zone_id'),
  category: text('category'), // 'ongoing' | 'pre-rehearsal' | 'archive'
  status: text('status').default('pre-rehearsal'), // 'ongoing' | 'pre-rehearsal' | 'archive' | 'draft'
  isActive: boolean('is_active').default(false),
  isArchived: boolean('is_archived').default(false),
  location: text('location'),
  bannerImage: text('banner_image'),
  songs: jsonb('songs'),
  songIds: jsonb('song_ids'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

export const praiseNights = programs;

/**
 * SUBGROUP PROGRAMS (formerly subgroup_praise_nights)
 * Rehearsal programs organized by specific choir sub-groups.
 */
export const subgroupPrograms = pgTable('subgroup_programs', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  zoneId: text('zone_id'),
  subGroupId: text('sub_group_id'),
  subGroupName: text('sub_group_name'),
  category: text('category'),
  status: text('status').default('pre-rehearsal'),
  isActive: boolean('is_active').default(false),
  isArchived: boolean('is_archived').default(false),
  songIds: jsonb('song_ids'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

export const subgroupPraiseNights = subgroupPrograms;

// ============================================================================
// 2. USERS, PROFILES & MEMBERSHIP (IDENTITY SOURCE OF TRUTH)
// ============================================================================

/**
 * PROFILES
 * Master user identity directory (740+ singers and administrators).
 */
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

/**
 * AUTH CREDENTIALS
 * Password hashes for email/password authentication.
 */
export const authCredentials = pgTable('auth_credentials', {
  profileId: text('profile_id')
    .primaryKey()
    .references(() => profiles.id),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});

/**
 * REFRESH TOKENS
 * Active JWT session tokens.
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

// ============================================================================
// 3. ZONES & SUBGROUPS
// ============================================================================

/**
 * ZONES
 * All 20 organizational zones across the ministry (HQ + regional zones).
 */
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
  rawData: jsonb('raw_data'),
});

/**
 * ZONE MEMBERS
 * Links users to their specific local zone memberships.
 */
export const zoneMembers = pgTable('zone_members', {
  id: text('id').primaryKey(),
  zoneId: text('zone_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').default('member'),
  status: text('status').default('active'),
  invitedBy: text('invited_by'),
  joinedAt: timestamp('joined_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

export const individualSubscriptions = pgTable('individual_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tier: text('tier'),
  plan: text('plan'),
  status: text('status').default('active'),
  paymentRef: text('payment_ref'),
  expiresAt: text('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
  rawData: jsonb('raw_data'),
});

/**
 * HQ MEMBERS
 * Dedicated table tracking users with official HQ group memberships.
 */
export const hqMembers = pgTable('hq_members', {
  id: text('id').primaryKey(),
  hqGroupId: text('hq_group_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').default('member'),
  status: text('status').default('active'),
  invitedBy: text('invited_by'),
  userEmail: text('user_email'),
  userName: text('user_name'),
  joinedAt: timestamp('joined_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
  rawData: jsonb('raw_data'),
});

/**
 * ADMIN REQUESTS
 * Tracks self-service coordinator / admin role upgrade requests submitted by users for HQ approval.
 */
export const adminRequests = pgTable('admin_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  userEmail: text('user_email'),
  userName: text('user_name'),
  zoneId: text('zone_id'),
  zoneCode: text('zone_code'),
  requestedRole: text('requested_role').default('zone_admin'),
  status: text('status').default('pending'), // 'pending', 'approved', 'rejected'
  reason: text('reason'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
  rawData: jsonb('raw_data'),
});

/**
 * SUBGROUPS
 * Internal sub-sections within a choir (e.g. Soprano, Alto, Tenor, Band).
 */
export const subgroups = pgTable('subgroups', {
  id: text('id').primaryKey(),
  name: text('name'),
  zoneId: text('zone_id'),
  description: text('description'),
  rawData: jsonb('raw_data'),
});

// ============================================================================
// 4. CHATS, MESSAGES & REAL-TIME COMMUNICATION
// ============================================================================

/**
 * CHATS (Promoted standard table)
 * Group and 1-on-1 conversations.
 */
export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  type: text('type'),
  createdBy: text('created_by'),
  participants: jsonb('participants'),
  participantDetails: jsonb('participant_details'),
  unreadCount: jsonb('unread_count'),
  rawData: jsonb('raw_data'),
});

/** Backward compatibility alias */
export const chatsV2 = chats;

/**
 * MESSAGES (Promoted standard table)
 * Individual chat messages within a conversation.
 */
export const messages = pgTable('messages', {
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

/** Backward compatibility alias */
export const messagesV2 = messages;

/**
 * CALLS
 * Voice and video call records.
 */
export const calls = pgTable('calls', {
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

/** Backward compatibility alias */
export const callsV2 = calls;

/**
 * USER STATUSES
 * Real-time status / stories.
 */
export const userStatuses = pgTable('user_statuses', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

/** Backward compatibility alias */
export const statusesV2 = userStatuses;

// ============================================================================
// 5. SCHEDULES, PROGRAMS & EVENTS
// ============================================================================

/**
 * SCHEDULE PROGRAMS
 * Weekly and daily rehearsal schedules, routines, and service song lists.
 */
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

export const schedule = schedulePrograms;

export const scheduleCategories = pgTable('schedule_categories', {
  id: text('id').primaryKey(),
  label: text('label'),
  icon: text('icon'),
  color: text('color'),
  isActive: boolean('is_active'),
  parentId: text('parent_id'),
  rawData: jsonb('raw_data'),
});

export const upcomingEvents = pgTable('upcoming_events', {
  id: text('id').primaryKey(),
  title: text('title'),
  date: text('date'),
  type: text('type'),
  zoneId: text('zone_id'),
  location: text('location'),
  description: text('description'),
  rawData: jsonb('raw_data'),
});

// ============================================================================
// 6. ATTENDANCE & ACTIVITY AUDIT LOGS
// ============================================================================

/**
 * ATTENDANCE
 * Rehearsal check-ins via QR codes.
 */
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

/**
 * ACTIVITY LOGS
 * System-wide audit logs tracking who performed what action.
 */
export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

/**
 * SONG HISTORY
 * Audit log of changes to song lyrics, keys, tempo, and arrangements.
 */
export const songHistory = pgTable('song_history', {
  id: text('id').primaryKey(),
  type: text('type'),
  title: text('title'),
  songId: text('song_id'),
  newValue: text('new_value'),
  oldValue: text('old_value'),
  createdAt: timestamp('created_at'),
  createdBy: text('created_by'),
  description: text('description'),
  rawData: jsonb('raw_data'),
});

// ============================================================================
// 7. USER FAVORITES, PLAYLISTS & NOTES
// ============================================================================

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

// ============================================================================
// 8. NOTIFICATIONS & MEDIA ASSETS
// ============================================================================

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

export const pushNotifications = pgTable('push_notifications', {
  id: text('id').primaryKey(),
  type: text('type'),
  title: text('title'),
  message: text('message'),
  category: text('category'),
  priority: text('priority'),
  broadcast: boolean('broadcast'),
  actionUrl: text('action_url'),
  createdAt: text('created_at'),
  targetAudience: text('target_audience'),
  rawData: jsonb('raw_data'),
});

export const mediaVideos = pgTable('media_videos', {
  id: text('id').primaryKey(),
  title: text('title'),
  type: text('type'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  description: text('description'),
  forHq: boolean('for_hq'),
  isYoutube: boolean('is_youtube'),
  featured: boolean('featured'),
  views: integer('views'),
  likes: integer('likes'),
  createdBy: text('created_by'),
  createdByName: text('created_by_name'),
  rawData: jsonb('raw_data'),
});

export const mediaAssets = pgTable('media_assets', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const zoneMediaAssets = pgTable('zone_media_assets', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const mediaCategories = pgTable('media_categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const mediaPlaylists = pgTable('media_playlists', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const appUpdates = pgTable('app_updates', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  title: text('title'),
  description: text('description'),
  isForced: boolean('is_forced').default(false),
  platform: text('platform'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userGroups = pgTable('user_groups', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const userNotifications = pgTable('user_notifications', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const zonePrograms = pgTable('zone_programs', {
  id: text('id').primaryKey(),
  name: text('name'),
  date: text('date'),
  zoneId: text('zone_id'),
  category: text('category'),
  status: text('status').default('pre-rehearsal'),
  isActive: boolean('is_active').default(false),
  isArchived: boolean('is_archived').default(false),
  location: text('location'),
  bannerImage: text('banner_image'),
  songs: jsonb('songs'),
  songIds: jsonb('song_ids'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

export const zonePraiseNights = zonePrograms;

export const pageCategories = pgTable('page_categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const zonePageCategories = pgTable('zone_page_categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

export const zoneCategories = pgTable('zone_categories', {
  id: text('id').primaryKey(),
  rawData: jsonb('raw_data'),
});

// ============================================================================
// 10. DEDICATED SUPPORT SYSTEM
// ============================================================================

/**
 * SUPPORT TICKETS
 * Dedicated support requests and tickets (separate from regular user chats).
 */
export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),
  subject: text('subject'),
  category: text('category').default('general'),
  status: text('status').default('open'),
  priority: text('priority').default('normal'),
  zoneId: text('zone_id'),
  lastMessage: text('last_message'),
  lastTimestamp: timestamp('last_timestamp').defaultNow(),
  unreadByAdmin: integer('unread_by_admin').default(0),
  unreadByUser: integer('unread_by_user').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  rawData: jsonb('raw_data'),
});

export const support = supportTickets;

/**
 * SUPPORT MESSAGES
 * Conversation messages inside a support ticket.
 */
export const supportMessages = pgTable('support_messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull(),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name'),
  senderType: text('sender_type').default('user'),
  message: text('message').notNull(),
  attachments: jsonb('attachments'),
  createdAt: timestamp('created_at').defaultNow(),
  rawData: jsonb('raw_data'),
});
