import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from './auth.middleware';
import {
  login,
  refresh,
  logout,
  getMe,
  register,
  AuthError,
  setPasswordForProfile,
  issueTokensForProfile,
} from './auth.service';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts, please try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  zone_code: z.string().min(6),
  designation: z.string().optional(),
  kingschat_id: z.string().optional(),
}).strict();

const refreshSchema = z.object({
  userId: z.string().min(1),
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  newPassword: z.string().min(6),
});

const kingsChatLoginSchema = z.object({
  accessToken: z.string().min(1),
});

// POST /auth/register
router.post('/register', loginLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const result = await register({
      email: parsed.data.email,
      password: parsed.data.password,
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      zoneCode: parsed.data.zone_code,
      designation: parsed.data.designation,
      kingschatId: parsed.data.kingschat_id,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    console.error('[auth/register]', err);
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const result = await login(parsed.data.email, parsed.data.password);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const result = await refresh(parsed.data.refreshToken, parsed.data.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: 'Invalid or expired refresh token' });
      return;
    }
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const { jti, exp, userId } = res.locals.auth;
    await logout(jti, exp, userId, parsed.data.refreshToken);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getMe(res.locals.auth.userId);
    res.json({ success: true, data: user });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: 'User not found' });
      return;
    }
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// POST /auth/kingschat-login
router.post('/kingschat-login', async (req, res) => {
  const parsed = kingsChatLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const { accessToken, kingschatUserId, email } = req.body as { accessToken: string; kingschatUserId?: string; email?: string };

    // Fetch KingsChat user profile via local proxy or token decode
    let kcUserId: string | null = kingschatUserId ?? null;
    if (!kcUserId) {
      try {
        // Attempt to decode JWT to extract userId
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          kcUserId = payload.userId || payload.sub || payload.id || null;
        }
      } catch {}
    }

    if (!kcUserId) {
      res.status(400).json({ success: false, error: 'Could not identify KingsChat user' });
      return;
    }

    const { eq } = await import('drizzle-orm');
    const { db } = await import('../db');
    const { profiles } = await import('../schema');

    // Look up by KingsChat ID (and optionally email for multi-account) — profiles only
    let matchingProfiles;
    if (email) {
      const { sql } = await import('drizzle-orm');
      matchingProfiles = await db.select().from(profiles)
        .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`).limit(5);
    } else {
      matchingProfiles = await db.select().from(profiles)
        .where(eq(profiles.kingschatId, kcUserId)).limit(5);
    }

    if (matchingProfiles.length === 0) {
      res.json({ success: false, code: 'NO_ACCOUNT', kingschatUserId: kcUserId, profile: null });
      return;
    }

    if (matchingProfiles.length > 1 && !email) {
      res.json({ success: false, code: 'MULTIPLE_ACCOUNTS', kingschatUserId: kcUserId, accounts: matchingProfiles });
      return;
    }

    const profile = matchingProfiles[0];
    const tokens = await issueTokensForProfile(profile);

    res.json({
      success: true,
      data: tokens,
    });
  } catch {
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const { email, newPassword } = parsed.data;

    const { sql } = await import('drizzle-orm');
    const { db } = await import('../db');
    const { profiles } = await import('../schema');

    const [profile] = await db.select().from(profiles)
      .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`).limit(1);

    if (!profile) {
      res.status(400).json({ success: false, error: 'No account found with that email.' });
      return;
    }

    await setPasswordForProfile(profile.id, newPassword);

    res.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

export default router;
