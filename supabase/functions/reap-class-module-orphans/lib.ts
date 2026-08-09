// Pure helpers for the class-module-files orphan reaper (unit-tested, no I/O).
// See supabase/functions/reap-class-module-orphans for the handler.

/** Split an array into batches of `size` (for chunked storage.remove calls). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Safety guard: only ever reap keys that match the exact class-module-files
 * path shape `class/{uuid}/item/{uuid}/…`. Even if the DB ever hands back an
 * unexpected name, we refuse to delete anything outside this shape.
 */
export function isReapableKey(name: string): boolean {
  return /^class\/[0-9a-fA-F-]{36}\/item\/[0-9a-fA-F-]{36}\/.+/.test(name);
}

export const __test = { chunk, isReapableKey };
