import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { apiKeyAuth } from './middleware/auth';
import masterSongsRouter from './routes/masterSongs';
import songsRouter from './routes/songs.routes';
import praiseNightSongsRouter from './routes/praiseNightSongs';
import authRouter from './auth/auth.routes';
import profilesRouter from './routes/profiles.routes';
import zonesRouter from './routes/zones.routes';
import membersRouter from './routes/members.routes';
import scheduleRouter from './routes/schedule.routes';
import praiseNightsRouter from './routes/praise-nights.routes';
import chatsRouter from './routes/chats.routes';
import callsRouter from './routes/calls.routes';
import subscriptionsRouter from './routes/subscriptions.routes';
import activityLogsRouter from './routes/activity-logs.routes';
import categoriesRouter from './routes/categories.routes';
import submittedSongsRouter from './routes/submitted-songs.routes';
import favoritesRouter from './routes/favorites.routes';
import playlistsRouter from './routes/playlists.routes';
import attendanceRouter from './routes/attendance.routes';
import settingsRouter from './routes/settings.routes';
import notificationsRouter from './routes/notifications.routes';
import subgroupsRouter from './routes/subgroups.routes';
import audioRouter from './routes/audio.routes';
import kingspayRouter from './routes/kingspay.routes';
import lexiconRouter from './routes/lexicon.routes';
import { writesRouter } from './routes/writes.routes';
import { createWsServer } from './ws/wsServer';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Rate limiter: 200 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(limiter);

// Health check — no auth needed
app.get('/health', (_, res) => {
  res.json({ status: 'ok', service: 'rehearsalhub-api', timestamp: new Date().toISOString() });
});

// Root info — no auth needed
app.get('/', (_, res) => {
  res.json({
    service: 'RehearsalHub Songs API',
    version: '1.0.0',
    endpoints: {
      masterSongs: '/api/master-songs',
      masterSongById: '/api/master-songs/:id',
      praiseNightSongs: '/api/praise-night-songs',
      praiseNightSongById: '/api/praise-night-songs/:id',
      praiseNightSongsFiltered: '/api/praise-night-songs?praiseNightId=xxx',
    },
    auth: 'All /api/* routes require header: x-api-key: <your-key>',
  });
});

// Auth routes — no x-api-key required
app.use('/auth', authRouter);

// Protected user API routes — require JWT via requireAuth middleware
app.use('/profiles', profilesRouter);
app.use('/zones', zonesRouter);
app.use('/members', membersRouter);
app.use('/schedule', scheduleRouter);
app.use('/praise-nights', praiseNightsRouter);
app.use('/chats', chatsRouter);
app.use('/calls', callsRouter);
app.use('/subscriptions', subscriptionsRouter);
app.use('/activity-logs', activityLogsRouter);
app.use('/categories', categoriesRouter);
app.use('/submitted-songs', submittedSongsRouter);
app.use('/songs', songsRouter);
app.use('/favorites', favoritesRouter);
app.use('/playlists', playlistsRouter);
app.use('/attendance', attendanceRouter);
app.use('/settings', settingsRouter);
app.use('/notifications', notificationsRouter);
app.use('/subgroups', subgroupsRouter);
app.use('/audio', audioRouter);
app.use('/kingspay', kingspayRouter);
app.use('/lexicon', lexiconRouter);

// Write endpoints — require JWT
app.use('/', writesRouter);

// Public song endpoints — require x-api-key header (unchanged)
app.use('/api/master-songs', apiKeyAuth, masterSongsRouter);
app.use('/api/praise-night-songs', apiKeyAuth, praiseNightSongsRouter);

// Public settings endpoint (used by AppUpdateChecker before login)
app.get('/api/settings/:id', apiKeyAuth, async (req, res) => {
  try {
    const { eq } = await import('drizzle-orm');
    const { db } = await import('./db');
    const { settings } = await import('./schema');
    const { mergeRawRow } = await import('./lib/rawRow');
    
    const [row] = await db.select().from(settings).where(eq(settings.id, req.params.id)).limit(1);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    
    res.json({ success: true, data: mergeRawRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// 404 handler
app.use((_, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

const httpServer = http.createServer(app);
createWsServer(httpServer);

httpServer.listen(PORT, async () => {
  console.log(`🎵 RehearsalHub API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Docs:   http://localhost:${PORT}/`);

  if (!process.env.JWT_SECRET) console.warn('   WARNING: JWT_SECRET is not set');
  if (!process.env.JWT_EXPIRES_IN) console.warn('   WARNING: JWT_EXPIRES_IN not set, defaulting to 15m');
  if (!process.env.REFRESH_TOKEN_EXPIRES_DAYS) console.warn('   WARNING: REFRESH_TOKEN_EXPIRES_DAYS not set, defaulting to 30');

  // Warm up the DB connection on startup so first real request doesn't fail
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`SELECT 1`);
    console.log(`   DB connection warmed up ✓`);
  } catch (e) {
    console.warn(`   DB warmup failed (will retry on first request):`, (e as Error).message);
  }
});
