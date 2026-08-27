import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JsonWebTokenError, TokenExpiredError } from './token';
import { revocationStore } from './revocation';
import { resolveTenantScope, withTenantTransaction } from '../middleware/tenant.middleware';

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

    const authData = {
      userId: payload.sub,
      role: payload.role,
      /** Tenant identity comes from the signed token; headers only select HQ views. */
      zoneId: payload.zoneId || null,
      /** churchId from JWT claim — set for church_coordinator role */
      churchId: payload.churchId || null,
      jti: payload.jti,
      exp: payload.exp!,
    };

    res.locals.auth = authData;
    req.tenant = resolveTenantScope(req, authData);

    withTenantTransaction(req, res, req.tenant, next);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    next(err);
  }
}
