import { useMemo, useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { Button } from "@/design-system";

import { useCommunityEventsWeek } from "@/hooks/useCommunityEventsWeek";
import { addWeeks, formatWeekLabel, getWeekRange } from "@/lib/events/weekRange";
import { formatTimeRangeWithZone, getTimezoneAbbreviation } from "@/lib/events/formatEventTime";
import { EventDetailDialog } from "./EventDetailDialog";
import type { CommunityEvent } from "./CommunityEventCard";
import { cn } from "@/lib/utils";

interface Props {
  timeZone: string;
  fallbackUrl: string;
}

const HOUR_PX = 48; // each hour = 48px
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface PositionedEvent {
  ev: CommunityEvent;
  dayIdx: number; // 0=Mon
  topPx: number;
  heightPx: number;
  col: number;
  cols: number;
}

/**
 * Lay out timed events in a single day column with overlap stacking.
 * Returns each event with `col` (0-indexed) and `cols` (cluster width).
 */
function layoutDay(events: { ev: CommunityEvent; topPx: number; heightPx: number }[]): {
  ev: CommunityEvent;
  topPx: number;
  heightPx: number;
  col: number;
  cols: number;
}[] {
  const sorted = [...events].sort((a, b) => a.topPx - b.topPx);
  const result: typeof sorted & { col: number; cols: number }[] = [] as any;
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy column assignment
    const cols: number[] = []; // end px per column
    const assigned: { item: (typeof sorted)[number]; col: number }[] = [];
    for (const item of cluster) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] <= item.topPx) {
          cols[i] = item.topPx + item.heightPx;
          assigned.push({ item, col: i });
          placed = true;
          break;
        }
      }
      if (!placed) {
        assigned.push({ item, col: cols.length });
        cols.push(item.topPx + item.heightPx);
      }
    }
    const totalCols = cols.length;
    for (const a of assigned) {
      (result as any).push({ ...a.item, col: a.col, cols: totalCols });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    if (cluster.length === 0 || item.topPx < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.topPx + item.heightPx);
    } else {
      flush();
      cluster.push(item);
      clusterEnd = item.topPx + item.heightPx;
    }
  }
  flush();
  return result as any;
}

export function WeekCalendar({ timeZone, fallbackUrl }: Props) {
  const [refDate, setRefDate] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<CommunityEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { start: weekStart, end: weekEnd } = useMemo(
    () => getWeekRange(refDate, timeZone),
    [refDate, timeZone]
  );

  // Bound week navigation: cannot go before the current week, cannot go more
  // than one year ahead. Keeps the view aligned with what the cache holds and
  // prevents users from ever seeing stale/historical data.
  const { start: currentWeekStart } = useMemo(() => getWeekRange(new Date(), timeZone), [timeZone]);
  const maxWeekStart = useMemo(() => addWeeks(currentWeekStart, 51), [currentWeekStart]);

  // Defense-in-depth: if HMR / persisted state / hot reload ever leaves an
  // out-of-bounds refDate behind, snap back to "now" on mount + on TZ change.
  useEffect(() => {
    if (
      weekStart.getTime() < currentWeekStart.getTime() ||
      weekStart.getTime() > maxWeekStart.getTime()
    ) {
      setRefDate(new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeekStart.getTime(), maxWeekStart.getTime()]);

  const canGoBack = weekStart.getTime() > currentWeekStart.getTime();
  const canGoForward = weekStart.getTime() < maxWeekStart.getTime();

  const { data, isLoading, isError } = useCommunityEventsWeek(weekStart);

  // Auto-scroll to 8 AM on mount/week change
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_PX * 7;
  }, [weekStart.getTime()]);

  const todayIso = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const tzAbbr = getTimezoneAbbreviation(timeZone);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
      return {
        date: d,
        iso: formatInTimeZone(d, timeZone, "yyyy-MM-dd"),
        dayLabel: DAY_NAMES[i],
        dayNum: formatInTimeZone(d, timeZone, "d"),
      };
    });
  }, [weekStart, timeZone]);

  const { allDay, positioned } = useMemo(() => {
    // Final render-time floor: never display anything older than 1 day, even
    // if a stale client cache or buggy expansion returns old events.
    const HARD_FLOOR_MS = Date.now() - 24 * 60 * 60 * 1000;
    const allDay: { ev: CommunityEvent; dayIdx: number }[] = [];
    const perDay: { ev: CommunityEvent; topPx: number; heightPx: number }[][] = Array.from(
      { length: 7 },
      () => []
    );
    for (const ev of data ?? []) {
      const start = new Date(ev.startUtc);
      const end = new Date(ev.endUtc);
      if (start.getTime() < HARD_FLOOR_MS) continue; // stale guard
      const startIso = formatInTimeZone(start, timeZone, "yyyy-MM-dd");
      const dayIdx = days.findIndex((d) => d.iso === startIso);
      if (dayIdx < 0) continue; // outside this week
      if (ev.allDay) {
        allDay.push({ ev, dayIdx });
        continue;
      }
      const startMinutes =
        Number(formatInTimeZone(start, timeZone, "H")) * 60 +
        Number(formatInTimeZone(start, timeZone, "m"));
      // Cap end to end of same day for layout (multi-day → full remainder of that day)
      const sameDayEnd = formatInTimeZone(end, timeZone, "yyyy-MM-dd") === startIso;
      const endMinutes = sameDayEnd
        ? Number(formatInTimeZone(end, timeZone, "H")) * 60 +
          Number(formatInTimeZone(end, timeZone, "m"))
        : 24 * 60;
      const topPx = (startMinutes / 60) * HOUR_PX;
      const heightPx = Math.max(20, ((endMinutes - startMinutes) / 60) * HOUR_PX);
      perDay[dayIdx].push({ ev, topPx, heightPx });
    }
    const positioned: PositionedEvent[] = [];
    perDay.forEach((items, dayIdx) => {
      const laid = layoutDay(items);
      for (const l of laid) {
        positioned.push({ ...l, dayIdx });
      }
    });
    return { allDay, positioned };
  }, [data, days, timeZone]);

  return (
    <>
      <div className="rounded-lg border bg-card">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefDate((d) => addWeeks(d, -1))}
              aria-label="Previous week"
              disabled={!canGoBack}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefDate(new Date())}
              aria-label="Jump to current week"
            >
              Today
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefDate((d) => addWeeks(d, 1))}
              aria-label="Next week"
              disabled={!canGoForward}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="text-sm font-medium text-foreground" aria-live="polite">
            {formatWeekLabel(weekStart, timeZone)}
          </div>
          <div className="text-xs text-muted-foreground">{tzAbbr || timeZone}</div>
        </div>

        {/* Header row */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-muted/20">
          <div />
          {days.map((d) => {
            const isToday = d.iso === todayIso;
            return (
              <div
                key={d.iso}
                className={cn(
                  "px-1 py-2 text-center text-xs font-medium",
                  isToday ? "text-primary" : "text-muted-foreground"
                )}
              >
                <div>{d.dayLabel}</div>
                <div
                  className={cn(
                    "mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm",
                    isToday ? "bg-primary text-primary-foreground font-semibold" : ""
                  )}
                >
                  {d.dayNum}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day strip */}
        {allDay.length > 0 && (
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b">
            <div className="px-1 py-1 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
              All&nbsp;day
            </div>
            {days.map((_, dayIdx) => (
              <div key={dayIdx} className="space-y-0.5 border-l p-1">
                {allDay
                  .filter((a) => a.dayIdx === dayIdx)
                  .map((a) => (
                    <button
                      key={a.ev.uid}
                      type="button"
                      onClick={() => setSelected(a.ev)}
                      className="block w-full truncate rounded bg-primary/15 px-1 py-0.5 text-left text-[11px] text-primary hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {a.ev.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}

        {/* Loading / Error states */}
        {isLoading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground" role="status">
            Loading events…
          </div>
        )}
        {isError && (
          <div
            role="alert"
            className="m-3 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden="true" />
              <p>
                Couldn't load events.{" "}
                <a
                  href={fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Open Google Calendar →
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Time grid */}
        {!isLoading && !isError && (
          <div ref={scrollRef} className="relative max-h-[640px] overflow-y-auto">
            <div
              className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]"
              style={{ height: HOUR_PX * 24 }}
            >
              {/* Hour gutter */}
              <div className="relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="border-b pr-1 text-right text-[10px] text-muted-foreground"
                    style={{ height: HOUR_PX }}
                  >
                    {h === 0 ? "" : `${((h - 1) % 12) + 1} ${h < 12 ? "AM" : "PM"}`}
                  </div>
                ))}
              </div>
              {/* Day columns */}
              {days.map((d, dayIdx) => {
                const isToday = d.iso === todayIso;
                return (
                  <div
                    key={d.iso}
                    className={cn("relative border-l", isToday && "bg-primary/[0.04]")}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="border-b border-border/50"
                        style={{ height: HOUR_PX }}
                      />
                    ))}
                    {positioned
                      .filter((p) => p.dayIdx === dayIdx)
                      .map((p) => {
                        const widthPct = 100 / p.cols;
                        const leftPct = widthPct * p.col;
                        return (
                          <button
                            key={p.ev.uid}
                            type="button"
                            onClick={() => setSelected(p.ev)}
                            className="absolute overflow-hidden rounded border border-primary/40 bg-primary/20 px-1 py-0.5 text-left text-[11px] leading-tight text-foreground hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              top: p.topPx,
                              height: p.heightPx,
                              left: `calc(${leftPct}% + 1px)`,
                              width: `calc(${widthPct}% - 2px)`,
                            }}
                            aria-label={`${p.ev.title}, ${formatTimeRangeWithZone(p.ev.startUtc, p.ev.endUtc, timeZone)}`}
                          >
                            <div className="truncate font-medium">{p.ev.title}</div>
                            {p.heightPx > 28 && (
                              <div className="truncate text-[10px] opacity-80">
                                {formatTimeRangeWithZone(p.ev.startUtc, p.ev.endUtc, timeZone)}
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isLoading && !isError && (data?.length ?? 0) === 0 && allDay.length === 0 && (
          <div className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
            No events this week.{" "}
            <button
              type="button"
              onClick={() => setRefDate((d) => addWeeks(d, 1))}
              className="text-primary hover:underline"
            >
              Try next week →
            </button>
          </div>
        )}
      </div>

      <EventDetailDialog
        event={selected}
        timeZone={timeZone}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}
