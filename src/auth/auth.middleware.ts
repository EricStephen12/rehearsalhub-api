import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JsonWebTokenError, TokenExpiredError } from './token';
import { revocationStore } from './revocation';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyAccessToken(token);

    if (revocationStore.isRevoked(payload.jti)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const activeZoneHeader = (req.headers['x-zone-id'] as string) || (req.headers['x-zone-code'] as string) || (req.query.zoneId as string) || (req.query.zone_code as string);

    res.locals.auth = {
      userId: payload.sub,
      role: payload.role,
      zoneId: activeZoneHeader || payload.zoneId,
      jti: payload.jti,
      exp: payload.exp!,
    };

    next();
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    next(err);
  }
}
