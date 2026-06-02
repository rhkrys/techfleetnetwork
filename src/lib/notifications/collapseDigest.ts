/**
 * In-app notification digest collapse (Part 2 §F1).
 *
 * Groups runs of >5 same-kind notifications within a 10-minute window into a
 * single "stack" row. Stacks expose the underlying notifications via `children`
 * so the UI can offer "Show all".
 *
 * Pure / deterministic — safe for memoization in components.
 */

import type { AppNotification } from "@/services/notification.service";

export type DigestStack = AppNotification & {
  isStack: true;
  stackCount: number;
  stackKind: string;
  children: AppNotification[];
};

export type DigestRow = AppNotification | DigestStack;

const WINDOW_MS = 10 * 60 * 1000;
const MIN_BURST = 5;

export function isStack(row: DigestRow): row is DigestStack {
  return (row as DigestStack).isStack === true;
}

/**
 * Collapse same-kind bursts (>= MIN_BURST within WINDOW_MS) into a stack row.
 * Input is assumed sorted by created_at desc (newest first). Output preserves
 * that order and replaces qualifying runs with a single stack row.
 */
export function collapseNotificationsToDigest(
  notifications: AppNotification[],
): DigestRow[] {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const out: DigestRow[] = [];
  let i = 0;
  while (i < notifications.length) {
    const head = notifications[i];
    const kind = head.notification_type;
    const headTs = new Date(head.created_at).getTime();

    // Walk forward while same kind and within window from head.
    let j = i + 1;
    while (j < notifications.length) {
      const next = notifications[j];
      if (next.notification_type !== kind) break;
      const nextTs = new Date(next.created_at).getTime();
      if (Number.isFinite(headTs) && Number.isFinite(nextTs)) {
        if (headTs - nextTs > WINDOW_MS) break;
      }
      j++;
    }

    const runLen = j - i;
    if (runLen >= MIN_BURST) {
      const children = notifications.slice(i, j);
      const unreadCount = children.filter((c) => !c.read).length;
      const stack: DigestStack = {
        ...head,
        id: `stack:${kind}:${head.id}`,
        title: `${runLen} ${kind.replace(/_/g, " ")} updates`,
        body_html: `Grouped ${runLen} notifications from the last 10 minutes.`,
        read: unreadCount === 0,
        isStack: true,
        stackCount: runLen,
        stackKind: kind,
        children,
      };
      out.push(stack);
      i = j;
    } else {
      out.push(head);
      i++;
    }
  }
  return out;
}
