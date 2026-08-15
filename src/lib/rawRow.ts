/** Merge Supabase column fields with firestore-shaped `raw_data` for Mobile clients. */
export function mergeRawRow<T extends { id: string; rawData?: unknown }>(
  row: T,
): Record<string, unknown> {
  const raw =
    row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? (row.rawData as Record<string, unknown>)
      : {};
  const { rawData: _omit, ...cols } = row;
  return { ...raw, ...cols, id: row.id };
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
