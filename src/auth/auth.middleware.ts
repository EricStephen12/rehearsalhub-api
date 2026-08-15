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

    res.locals.auth = {
      userId: payload.sub,
      role: payload.role,
      zoneId: payload.zoneId,
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
