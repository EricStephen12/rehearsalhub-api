import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { apiKeyAuth } from './middleware/auth';
import masterSongsRouter from './routes/masterSongs';
import praiseNightSongsRouter from './routes/praiseNightSongs';

const app = express();
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

// Protected routes — all require x-api-key header
app.use('/api/master-songs', apiKeyAuth, masterSongsRouter);
app.use('/api/praise-night-songs', apiKeyAuth, praiseNightSongsRouter);

// 404 handler
app.use((_, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.listen(PORT, async () => {
  console.log(`🎵 RehearsalHub API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Docs:   http://localhost:${PORT}/`);

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
