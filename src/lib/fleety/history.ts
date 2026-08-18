// Group a member's saved conversations into recency buckets for the history sidebar — the pattern
// Claude and ChatGPT use (Today / Yesterday / Previous 7 Days / Previous 30 Days / Older). Pure and
// deterministic: `now` is injected so the bucketing is testable and never calls Date.now() itself.
// Shared by both chat surfaces (ChatPage + FleetyChatWidget) so the grouping can't drift.

export interface DatedConversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface ConversationGroup<T> {
  /** Bucket label, e.g. "Today". */
  label: string;
  items: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight for a date (start of that calendar day). */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Bucket conversations by how recently they were updated, preserving the caller's ordering within
 * each bucket (callers pass newest-first). Empty buckets are omitted. Rows with an unparseable
 * `updated_at` fall into "Older" rather than being dropped.
 */
export function groupConversationsByDate<T extends { updated_at: string }>(
  items: T[],
  now: Date
): ConversationGroup<T>[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const sevenStart = todayStart - 7 * DAY_MS;
  const thirtyStart = todayStart - 30 * DAY_MS;

  const buckets: { label: string; items: T[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Previous 30 Days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const item of items) {
    const t = new Date(item.updated_at).getTime();
    if (Number.isNaN(t)) {
      buckets[4].items.push(item);
    } else if (t >= todayStart) {
      buckets[0].items.push(item);
    } else if (t >= yesterdayStart) {
      buckets[1].items.push(item);
    } else if (t >= sevenStart) {
      buckets[2].items.push(item);
    } else if (t >= thirtyStart) {
      buckets[3].items.push(item);
    } else {
      buckets[4].items.push(item);
    }
  }

  return buckets.filter((b) => b.items.length > 0);
}
