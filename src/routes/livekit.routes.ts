import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { requireAuth } from '../auth/auth.middleware';

const router = Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://rehearsal-hub-livekit.cloud';

/**
 * Shared token generator — works for both GET and POST.
 * room: the LiveKit room name (usually the callId)
 * participant: the user's unique ID (used as the participant identity)
 */
async function generateToken(room: string, participant: string): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participant,
    // Token valid for 4 hours — long enough for any realistic call
    ttl: '4h',
  });

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}

/**
 * GET /livekit-token?room=<roomName>&participant=<userId>
 * Used by rehearsalhubv2 (CallScreen.tsx) to join a call room.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { room, participant } = req.query as { room?: string; participant?: string };

    if (!room || !participant) {
      res.status(400).json({ success: false, error: 'room and participant query params are required' });
      return;
    }

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error('[livekit-token] LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set');
      res.status(503).json({ success: false, error: 'LiveKit is not configured on this server' });
      return;
    }

    const token = await generateToken(room, participant);

    res.json({
      success: true,
      token,
      url: LIVEKIT_URL,
      room,
      participant,
    });
  } catch (err) {
    console.error('[livekit-token:get]', err);
    res.status(500).json({ success: false, error: 'Failed to generate LiveKit token' });
  }
});

/**
 * POST /livekit-token
 * Body: { room: string, participant: string }
 * Used by the web portal (or any client that prefers POST over GET).
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { room, participant } = req.body as { room?: string; participant?: string };

    if (!room || !participant) {
      res.status(400).json({ success: false, error: 'room and participant body fields are required' });
      return;
    }

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error('[livekit-token] LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set');
      res.status(503).json({ success: false, error: 'LiveKit is not configured on this server' });
      return;
    }

    const token = await generateToken(room, participant);

    res.json({
      success: true,
      token,
      url: LIVEKIT_URL,
      room,
      participant,
    });
  } catch (err) {
    console.error('[livekit-token:post]', err);
    res.status(500).json({ success: false, error: 'Failed to generate LiveKit token' });
  }
});

export default router;
