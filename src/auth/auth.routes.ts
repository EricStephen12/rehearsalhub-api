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
  email: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  password: z.string().min(1),
}).refine((data) => Boolean(data.email || data.username || data.identifier), {
  message: 'Email or username is required',
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

    // HQ zone registration — account awaiting admin approval
    if ('pendingApproval' in result && result.pendingApproval) {
      res.status(202).json({
        success: true,
        pendingApproval: true,
        userId: result.userId,
        message: 'Your application to join an HQ group has been submitted. You will be notified once an admin approves your account.',
      });
      return;
    }

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
    const userIdentifier = parsed.data.identifier || parsed.data.username || parsed.data.email!;
    const result = await login(userIdentifier, parsed.data.password);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AuthError) {
      // Special: HQ join request pending admin approval
      if (err.message === 'PENDING_APPROVAL') {
        res.status(403).json({ success: false, code: 'PENDING_APPROVAL', error: 'Your account is awaiting HQ admin approval. You will be notified when approved.' });
        return;
      }
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

// POST /auth/kingschat-login & /auth/kingschat
const handleKingsChatLogin = async (req: any, res: any) => {
  const parsed = kingsChatLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid request body' });
    return;
  }

  try {
    const { accessToken, kingschatUserId, email, profile: clientProfile } = req.body as {
      accessToken: string;
      kingschatUserId?: string;
      email?: string;
      profile?: any;
    };

    let kcUserId: string | null = kingschatUserId || clientProfile?.userId || clientProfile?.id || null;
    let verifiedEmail: string | null = email ? email.trim().toLowerCase() : (clientProfile?.email ? String(clientProfile.email).trim().toLowerCase() : null);
    let verifiedProfileData: any = clientProfile || null;

    // 1. Verify with KingsChat Developer API endpoints
    const KINGSCHAT_API_KEY = process.env.KINGSCHAT_API_KEY || '';
    const endpoints = [
      'https://connect.kingsch.at/developer/api/user/profile',
      'https://connect.kingsch.at/developer/api/profile',
      'https://connect.kingschat.online/developer/api/user/profile',
      'https://connect.kingschat.online/developer/api/profile',
    ];

    if (KINGSCHAT_API_KEY) {
      for (const endpoint of endpoints) {
        try {
          const kcRes = await fetch(endpoint, {
            headers: {
              'api-key': KINGSCHAT_API_KEY,
              'X-Api-Key': KINGSCHAT_API_KEY,
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
          });

          if (kcRes.ok) {
            const kcData: any = await kcRes.json();
            const p = kcData?.profile || kcData?.user || kcData?.data || kcData;
            if (p?.id || p?.userId || p?.user_id) {
              kcUserId = p.id || p.userId || p.user_id;
              if (p.email) verifiedEmail = String(p.email).trim().toLowerCase();
              verifiedProfileData = p;
              break;
            }
          }
        } catch (fetchErr) {
          // continue to next endpoint
        }
      }
    }

    // 2. Decode JWT if kcUserId not found yet
    if (!kcUserId) {
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          kcUserId = payload.userId || payload.sub || payload.id || null;
          if (payload.email && !verifiedEmail) verifiedEmail = payload.email.trim().toLowerCase();
          if (!verifiedProfileData) {
            verifiedProfileData = {
              name: payload.name || `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
              username: payload.preferred_username || payload.username,
              email: payload.email,
            };
          }
        }
      } catch {}
    }

    if (!kcUserId && !verifiedEmail) {
      res.status(400).json({ success: false, error: 'Could not identify KingsChat user token' });
      return;
    }

    const { eq, or, sql } = await import('drizzle-orm');
    const { db } = await import('../db');
    const { profiles } = await import('../schema');

    // 3. Robust Multi-level Profile Lookup:
    // Match by kingschatId column OR rawData jsonb OR verified email
    const conditions = [];
    if (kcUserId) {
      conditions.push(eq(profiles.kingschatId, kcUserId));
      conditions.push(sql`${profiles.rawData}->>'kingschatId' = ${kcUserId}`);
      conditions.push(sql`${profiles.rawData}->>'kingschat_id' = ${kcUserId}`);
    }
    if (verifiedEmail) {
      conditions.push(sql`lower(${profiles.email}) = ${verifiedEmail}`);
    }

    let matchingProfiles = await db
      .select()
      .from(profiles)
      .where(or(...conditions))
      .limit(5);

    if (matchingProfiles.length === 0) {
      res.json({
        success: false,
        code: 'NO_ACCOUNT',
        kingschatUserId: kcUserId,
        profile: verifiedProfileData ? {
          kingschatId: kcUserId,
          email: verifiedEmail || '',
          firstName: verifiedProfileData.name?.split(' ')[0] || '',
          lastName: verifiedProfileData.name?.split(' ').slice(1).join(' ') || '',
          username: verifiedProfileData.username || '',
        } : null,
      });
      return;
    }

    if (matchingProfiles.length > 1 && !email) {
      res.json({ success: false, code: 'MULTIPLE_ACCOUNTS', kingschatUserId: kcUserId, accounts: matchingProfiles });
      return;
    }

    const profile = matchingProfiles[0];

    // 4. Auto-link KingsChat ID if not already explicitly attached
    if (kcUserId && profile.kingschatId !== kcUserId) {
      try {
        const prevRaw = (profile.rawData && typeof profile.rawData === 'object' ? profile.rawData : {}) as Record<string, any>;
        await db.update(profiles)
          .set({
            kingschatId: kcUserId,
            rawData: { ...prevRaw, kingschatId: kcUserId, kingschat_id: kcUserId },
          })
          .where(eq(profiles.id, profile.id));
      } catch (linkErr) {
        console.error('[KingsChat auto-link error]:', linkErr);
      }
    }

    const tokens = await issueTokensForProfile(profile);

    res.json({
      success: true,
      data: tokens,
      profile: {
        id: profile.id,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: profile.role,
        hasHqAccess: profile.hasHqAccess,
      },
    });
  } catch (err: any) {
    console.error('[auth/kingschat error]', err);
    res.status(500).json({ success: false, error: 'An error occurred during KingsChat login, Kindly try again' });
  }
};

router.post('/kingschat-login', handleKingsChatLogin);
router.post('/kingschat', handleKingsChatLogin);

// In-memory store for 6-digit password reset OTPs (email -> { otp, expiresAt })
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

// POST /auth/forgot-password/send-otp
router.post('/forgot-password/send-otp', async (req, res) => {
  try {
    const email = req.body.email?.trim()?.toLowerCase();
    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    const { sql } = await import('drizzle-orm');
    const { db } = await import('../db');
    const { profiles } = await import('../schema');
    const { sendPasswordResetOtpEmail } = await import('../services/email.service');

    const [profile] = await db.select().from(profiles)
      .where(sql`lower(${profiles.email}) = ${email}`).limit(1);

    if (!profile) {
      res.status(404).json({ success: false, error: 'No account registered with this email.' });
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(email, { otp, expiresAt });

    const singerName = profile.firstName || 'Singer';
    await sendPasswordResetOtpEmail(email, singerName, otp);

    res.json({ success: true, message: `OTP code sent to ${email}` });
  } catch (err: any) {
    console.error('[auth/forgot-password/send-otp]', err);
    res.status(500).json({ success: false, error: 'Failed to send OTP code' });
  }
});

// POST /auth/forgot-password/verify-otp
router.post('/forgot-password/verify-otp', async (req, res) => {
  try {
    const email = req.body.email?.trim()?.toLowerCase();
    const otp = req.body.otp?.trim();

    if (!email || !otp) {
      res.status(400).json({ success: false, error: 'Email and OTP are required' });
      return;
    }

    const stored = otpStore.get(email);
    if (!stored) {
      res.status(400).json({ success: false, error: 'No OTP requested for this email or OTP expired' });
      return;
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(email);
      res.status(400).json({ success: false, error: 'OTP code has expired. Please request a new one.' });
      return;
    }

    if (stored.otp !== otp) {
      res.status(400).json({ success: false, error: 'Invalid OTP code. Please check and try again.' });
      return;
    }

    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
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
    const cleanEmail = email.toLowerCase();

    const { sql } = await import('drizzle-orm');
    const { db } = await import('../db');
    const { profiles } = await import('../schema');

    const [profile] = await db.select().from(profiles)
      .where(sql`lower(${profiles.email}) = ${cleanEmail}`).limit(1);

    if (!profile) {
      res.status(400).json({ success: false, error: 'No account found with that email.' });
      return;
    }

    await setPasswordForProfile(profile.id, newPassword);
    otpStore.delete(cleanEmail);

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'An error occurred' });
  }
});

export default router;
