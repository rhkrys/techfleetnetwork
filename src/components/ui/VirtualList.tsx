/**
 * <VirtualList> — thin wrapper over @tanstack/react-virtual for long card grids.
 *
 * Purpose: maintain 60fps scrolling when item count > 50 in non-AG-Grid
 * surfaces (Recruiting Center card view, Members directory, Announcements feed).
 * AG Grid handles its own virtualization — do NOT use this inside AG Grid.
 *
 * Usage:
 *   <VirtualList
 *     items={members}
 *     estimateSize={() => 320}
 *     renderItem={(member, i) => <MemberCard key={member.id} member={member} />}
 *   />
 *
 * Accessibility:
 *   - Container is `role="list"`, each row `role="listitem"` — preserves
 *     screen-reader semantics that raw `transform: translateY()` would break.
 *   - Honors `prefers-reduced-motion` automatically (no scroll animations).
 *
 * WCAG: 1.3.1 (Info & Relationships), 2.1.1 (Keyboard) — Tab order follows
 * DOM order; virtualization only mounts visible rows so Tab cannot land on
 * an offscreen card.
 */
import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface VirtualListProps<T> {
  items: T[];
  estimateSize: (index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  className?: string;
  /** Container height (CSS). Default `100%`. Parent must constrain height. */
  height?: string;
  /** Optional aria-label for the list region. */
  ariaLabel?: string;
}

export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  overscan = 6,
  className,
  height = "100%",
  ariaLabel,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ height, overflow: "auto", contain: "strict" }}
      role="list"
      aria-label={ariaLabel}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => (
          <div
            key={vRow.key}
            role="listitem"
            data-index={vRow.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vRow.start}px)`,
            }}
          >
            {renderItem(items[vRow.index], vRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
