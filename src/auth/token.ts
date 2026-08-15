import jwt, { JwtPayload, JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import crypto from 'crypto';

const secret = process.env.JWT_SECRET!;
const expiresIn = process.env.JWT_EXPIRES_IN ?? '15m';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: string;
  zoneId?: string;
  jti: string;
}

export function signAccessToken(payload: { sub: string; role: string; zoneId?: string }): string {
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign(
    { sub: payload.sub, role: payload.role, zoneId: payload.zoneId, jti: crypto.randomUUID() },
    secret,
    { algorithm: 'HS256', expiresIn },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  if (!secret) throw new Error('JWT_SECRET is not set');
  // throws JsonWebTokenError or TokenExpiredError on failure — never swallowed
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export { JsonWebTokenError, TokenExpiredError };
