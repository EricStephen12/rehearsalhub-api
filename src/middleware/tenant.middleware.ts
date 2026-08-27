import { Request, Response, NextFunction } from 'express';

/**
 * Resolved tenant scope attached to every authenticated request.
 * Route handlers should READ this — never re-derive scope from query params or body.
 */
export interface TenantScope {
  /** 'global' = HQ Admin viewing all data. 'zone' = scoped to one zone. 'church' = scoped to one church. */
  mode: 'global' | 'zone' | 'church';

  /** Effective zone ID for this request (null = global view). Already security-locked to JWT claim for zone admins. */
  effectiveZoneId: string | null;

  /** Effective church/subgroup ID for this request (null if not in church scope). Already security-locked to JWT claim for church coordinators. */
  effectiveChurchId: string | null;

  /** True only for hq_admin / admin roles */
  isHQAdmin: boolean;

  /** True for zone_admin roles */
  isZoneAdmin: boolean;

  /** True for church_coordinator roles */
  isChurchCoordinator: boolean;

  /** True when HQ admin explicitly selected global view (no zone/church filter) */
  isGlobalView: boolean;
}

declare global {
  namespace Express {
    interface Request {
      tenant: TenantScope;
    }
  }
}

/** The canonical list of role strings that get full HQ Admin access. */
const HQ_ROLES = new Set(['hq_admin', 'admin', 'super_admin']);

/**
 * TENANCY MIDDLEWARE — runs after requireAuth on every protected route.
 *
 * Resolves the effective tenant scope for every request:
 * - HQ Admins: can freely switch between global / zone / church scope via X-Scope headers.
 * - Zone Admins: LOCKED to their JWT zoneId — header overrides are IGNORED for escalation.
 * - Church Coordinators: LOCKED to their JWT churchId and parent zoneId — header overrides are IGNORED.
 * - Regular members: locked to their JWT zoneId (read-only scope).
 *
 * Attaches req.tenant so all route handlers can use it directly without re-deriving scope.
 */
export function resolveTenantScope(req: Request, auth: any): TenantScope {
  if (!auth) {
    return {
      mode: 'global',
      effectiveZoneId: null,
      effectiveChurchId: null,
      isHQAdmin: false,
      isZoneAdmin: false,
      isChurchCoordinator: false,
      isGlobalView: true,
    };
  }

  const role: string = (auth.role || '').toLowerCase();
  const isHQAdmin = HQ_ROLES.has(role);
  const isZoneAdmin = role === 'zone_admin' || role === 'zone_coordinator' || role === 'subgroup_admin' || role === 'subgroup_coordinator';
  const isChurchCoordinator = role === 'church_coordinator';

  // Read client-requested scope headers (only trusted for HQ Admins)
  const headerZoneId = (req.headers['x-zone-id'] as string) || (req.headers['x-zone-code'] as string) || null;
  const headerChurchId = (req.headers['x-church-id'] as string) || (req.headers['x-subgroup-id'] as string) || null;
  const headerScope = (req.headers['x-scope'] as string) || null; // 'global' | 'zone' | 'church'

  // Also check query params for backward compat (clients should migrate to headers)
  const queryZoneId = (req.query.zoneId as string) || (req.query.zone_code as string) || null;
  const queryChurchId = (req.query.subGroupId as string) || (req.query.churchId as string) || null;

  let effectiveZoneId: string | null = null;
  let effectiveChurchId: string | null = null;
  let mode: 'global' | 'zone' | 'church' = 'global';

  if (isHQAdmin) {
    // HQ Admins can freely switch scopes. Trust their headers + query params.
    const requestedChurchId = headerChurchId || queryChurchId || null;
    const requestedZoneId = headerZoneId || queryZoneId || null;

    if (requestedChurchId && headerScope !== 'zone' && headerScope !== 'global') {
      effectiveChurchId = requestedChurchId;
      effectiveZoneId = requestedZoneId;
      mode = 'church';
    } else if (requestedZoneId && headerScope !== 'global') {
      effectiveZoneId = requestedZoneId;
      effectiveChurchId = null;
      mode = 'zone';
    } else {
      effectiveZoneId = null;
      effectiveChurchId = null;
      mode = 'global';
    }
  } else if (isChurchCoordinator) {
    // Church coordinators are HARD-LOCKED to their JWT churchId.
    effectiveChurchId = auth.churchId || null;
    effectiveZoneId = auth.zoneId || null;
    mode = 'church';
  } else if (isZoneAdmin) {
    // Zone admins are HARD-LOCKED to their JWT zoneId.
    effectiveZoneId = auth.zoneId || null;
    effectiveChurchId = null;
    mode = effectiveZoneId ? 'zone' : 'global';
  } else {
    // Regular members — lock to their JWT zone
    effectiveZoneId = auth.zoneId || null;
    effectiveChurchId = null;
    mode = effectiveZoneId ? 'zone' : 'global';
  }

  return {
    mode,
    effectiveZoneId,
    effectiveChurchId,
    isHQAdmin,
    isZoneAdmin,
    isChurchCoordinator,
    isGlobalView: mode === 'global',
  };
}

import { sql } from 'drizzle-orm';
import { baseDb, dbStorage } from '../db';

export function withTenantTransaction(
  req: Request,
  res: Response,
  tenant: TenantScope,
  next: NextFunction
): void {
  // If non-HQ role has no effectiveZoneId on a restricted route, reject immediately with 403
  if (!tenant.isHQAdmin && !tenant.effectiveZoneId) {
    res.status(403).json({ success: false, error: 'Forbidden: Missing tenant zone scope' });
    return;
  }

  baseDb.transaction(async (tx) => {
    const zoneVal = tenant.effectiveZoneId || '';
    const isHqVal = tenant.isHQAdmin || tenant.isGlobalView ? 'true' : 'false';
    const churchVal = tenant.effectiveChurchId || '';

    await tx.execute(sql`
      SELECT 
        set_config('app.current_zone_id', ${zoneVal}, true),
        set_config('app.is_hq', ${isHqVal}, true),
        set_config('app.current_church_id', ${churchVal}, true);
    `);

    await dbStorage.run(tx as any, async () => {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => resolve();
        res.once('finish', cleanup);
        res.once('close', cleanup);
        try {
          next();
        } catch (err) {
          reject(err);
        }
      });
    });
  }).catch((txErr) => {
    if (!res.headersSent) {
      console.error('[withTenantTransaction Error]:', txErr);
      res.status(500).json({ success: false, error: 'Tenant transaction failure' });
    }
  });
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = (res as any).locals?.auth;
  req.tenant = resolveTenantScope(req, auth);
  next();
}
