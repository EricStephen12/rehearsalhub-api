export type PlatformRole =
  | 'super_admin'
  | 'admin'
  | 'hq_admin'
  | 'boss'
  | 'zone_admin'
  | 'zone_coordinator'
  | 'subgroup_admin'
  | 'subgroup_coordinator'
  | 'church_coordinator'
  | 'member'

export function normalizeRole(role: unknown): PlatformRole | string {
  return String(role || 'member').toLowerCase()
}

export function isHQRole(role: unknown): boolean {
  const normalized = normalizeRole(role)
  return normalized === 'super_admin' || normalized === 'admin' || normalized === 'hq_admin'
}

export function isReadOnlyHQRole(role: unknown): boolean {
  return normalizeRole(role) === 'boss'
}

export function canAccessAdmin(role: unknown): boolean {
  const normalized = normalizeRole(role)
  return isHQRole(normalized) || normalized === 'zone_admin' || normalized === 'zone_coordinator' ||
    normalized === 'subgroup_admin' || normalized === 'subgroup_coordinator' || normalized === 'church_coordinator'
}

export function canManageAllTenants(role: unknown): boolean {
  return isHQRole(role)
}

export function canManageTenant(role: unknown): boolean {
  const normalized = normalizeRole(role)
  return isHQRole(normalized) || normalized === 'zone_admin' || normalized === 'zone_coordinator' ||
    normalized === 'subgroup_admin' || normalized === 'subgroup_coordinator' || normalized === 'church_coordinator'
}
