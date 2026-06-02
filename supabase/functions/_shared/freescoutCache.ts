// In-isolate response cache for freescout-proxy.
// Bounded (LRU, 500 entries) so memory stays well under the 256MB isolate cap.
// Per-(user, action, query) keys; admin tab fan-out collapses to one upstream
// fetch per 30s. Mutations bypass + invalidate.

const MAX_ENTRIES = 500;

interface Entry { exp: number; body: unknown }

const store = new Map<string, Entry>();

function touch(key: string, entry: Entry) {
  store.delete(key);
  store.set(key, entry);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function cacheKey(userId: string, action: string, query: unknown): Promise<string> {
  const payload = `${userId}|${action}|${JSON.stringify(query ?? null)}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCached<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.exp <= Date.now()) {
    store.delete(key);
    return null;
  }
  // Touch for LRU
  store.delete(key);
  store.set(key, entry);
  return entry.body as T;
}

export function setCached(key: string, body: unknown, ttlMs: number): void {
  touch(key, { exp: Date.now() + ttlMs, body });
}

/** Wipe all entries for a user (used after mutations). */
export function invalidateUser(userId: string): void {
  // Cheap brute-force: walk keys; cache is bounded to 500 so this is fine.
  // Key starts with the sha256 of "<userId>|..." — but we hashed it, so we
  // can't filter by prefix. Tag entries with a second index instead.
  const tagged = userTagIndex.get(userId);
  if (!tagged) return;
  for (const k of tagged) store.delete(k);
  userTagIndex.delete(userId);
}

const userTagIndex = new Map<string, Set<string>>();

export function tagForUser(userId: string, key: string): void {
  let set = userTagIndex.get(userId);
  if (!set) { set = new Set(); userTagIndex.set(userId, set); }
  set.add(key);
}

/** Wipe ALL entries (used after admin mutations affecting cross-user views). */
export function invalidateAll(): void {
  store.clear();
  userTagIndex.clear();
}
