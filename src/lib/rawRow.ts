/** Merge Supabase column fields with firestore-shaped `raw_data` for Mobile and Web clients. */
export function mergeRawRow<T extends { id: string; rawData?: unknown }>(
  row: T,
): Record<string, unknown> {
  const raw =
    row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData)
      ? (row.rawData as Record<string, unknown>)
      : {};
  const { rawData: _omit, ...cols } = row;
  const cleanCols: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cols)) {
    if (v !== null && v !== undefined) {
      cleanCols[k] = v;
    }
  }
  return { ...raw, ...cleanCols, id: row.id };
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
