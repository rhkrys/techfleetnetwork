// Regression tests for RRULE COUNT/UNTIL handling in expandOccurrences.
// Stops finite series from years ago being projected into the current week.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Re-implement a thin shim to reach the internal function without exporting.
// We import via dynamic eval of the source for test isolation.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
// Extract the expandOccurrences + parseIcsDate definitions for unit testing.
// We compile a small module that re-exports them.
// Drop handler-only relative imports (./auth.ts, ../_shared/...) — a data: URL
// module can't resolve relative specifiers. The parser code we test only needs
// the npm: fromZonedTime import, which is kept.
const stub = src
  .replace(/^import .*from "\.\.?\/.*";\s*$/gm, "")
  .replace(/Deno\.serve\([\s\S]*$/m, "")
  .concat("\nexport { expandOccurrences, parseIcsDate, applyRecurrenceOverrides };\n");
const mod = await import(
  "data:application/typescript;base64," + btoa(unescape(encodeURIComponent(stub)))
);

const { expandOccurrences, applyRecurrenceOverrides } = mod as {
  expandOccurrences: (
    ev: any,
    windowStart: Date,
    windowEnd: Date
  ) => Array<{ start: Date; end: Date }>;
  applyRecurrenceOverrides: (raw: any[]) => any[];
};

Deno.test("finite COUNT series from 2022 does not leak into 2026 window", () => {
  // Mirrors RRULE:FREQ=WEEKLY;COUNT=17;BYDAY=MO,WE on a 2022-10-12 master.
  const ev = {
    uid: "ruminate-2022",
    start: { date: new Date("2022-10-12T21:00:00Z"), allDay: false },
    end: { date: new Date("2022-10-12T22:00:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", COUNT: "17", BYDAY: "MO,WE", WKST: "SU" },
    exdates: [],
  };
  const occ = expandOccurrences(
    ev,
    new Date("2026-05-12T00:00:00Z"),
    new Date("2027-05-12T00:00:00Z")
  );
  assertEquals(occ.length, 0, "stale finite series must yield no future occurrences");
});

Deno.test("finite COUNT=2 series from 2022 (Rewire Neuro Sprint Demo)", () => {
  const ev = {
    uid: "rewire-2022",
    start: { date: new Date("2022-03-01T19:00:00Z"), allDay: false },
    end: { date: new Date("2022-03-01T20:00:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", COUNT: "2", BYDAY: "TU", WKST: "SU" },
    exdates: [],
  };
  const occ = expandOccurrences(
    ev,
    new Date("2026-05-12T00:00:00Z"),
    new Date("2027-05-12T00:00:00Z")
  );
  assertEquals(occ.length, 0);
});

Deno.test("UNTIL in the past prevents future occurrences", () => {
  const ev = {
    uid: "tst4-2023",
    start: { date: new Date("2023-04-14T16:30:00Z"), allDay: false },
    end: { date: new Date("2023-04-14T16:45:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", UNTIL: "20230515T000000Z", BYDAY: "TU,WE,TH,FR", WKST: "SU" },
    exdates: [],
  };
  const occ = expandOccurrences(
    ev,
    new Date("2026-05-12T00:00:00Z"),
    new Date("2027-05-12T00:00:00Z")
  );
  assertEquals(occ.length, 0);
});

Deno.test("ongoing weekly series still yields current-week occurrences", () => {
  // Started in 2024, no UNTIL/COUNT — should produce events in the 2026 window.
  const ev = {
    uid: "ongoing",
    start: { date: new Date("2024-01-01T15:00:00Z"), allDay: false },
    end: { date: new Date("2024-01-01T16:00:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", BYDAY: "MO", WKST: "SU" },
    exdates: [],
  };
  const occ = expandOccurrences(
    ev,
    new Date("2026-05-11T00:00:00Z"),
    new Date("2026-05-25T00:00:00Z")
  );
  // At least one Monday should fall in this 2-week window.
  if (occ.length === 0) throw new Error("expected at least one occurrence");
});

// ── MONTHLY BYDAY (nth-weekday-of-month) — the "AI Insight" wrong-day bug ──
Deno.test("MONTHLY;BYDAY=2TU lands on the 2nd Tuesday, not DTSTART's day-of-month", () => {
  // DTSTART 2026-07-14 (2nd Tue of July) 18:00 ET = 22:00Z. August's 2nd Tuesday
  // is the 11th, NOT the 14th (a Friday) — the exact bug the user reported.
  const ev = {
    uid: "ai-insight",
    start: { date: new Date("2026-07-14T22:00:00Z"), allDay: false },
    end: { date: new Date("2026-07-14T23:00:00Z"), allDay: false },
    rrule: { FREQ: "MONTHLY", BYDAY: "2TU" },
    exdates: [],
  };
  const occ = expandOccurrences(
    ev,
    new Date("2026-08-01T00:00:00Z"),
    new Date("2026-09-01T00:00:00Z")
  );
  assertEquals(occ.length, 1);
  assertEquals(occ[0].start.toISOString(), "2026-08-11T22:00:00.000Z");
  assertEquals(occ[0].start.getUTCDay(), 2, "must be a Tuesday");
});

Deno.test("MONTHLY;BYDAY=-1FR lands on the last Friday of the month", () => {
  const ev = {
    uid: "last-friday",
    start: { date: new Date("2026-08-28T17:00:00Z"), allDay: false },
    end: { date: new Date("2026-08-28T18:00:00Z"), allDay: false },
    rrule: { FREQ: "MONTHLY", BYDAY: "-1FR" },
    exdates: [],
  };
  // Sept 2026: the last Friday is the 25th.
  const occ = expandOccurrences(
    ev,
    new Date("2026-09-01T00:00:00Z"),
    new Date("2026-10-01T00:00:00Z")
  );
  assertEquals(occ.length, 1);
  assertEquals(occ[0].start.toISOString(), "2026-09-25T17:00:00.000Z");
});

// ── RECURRENCE-ID reconciliation — the "Hand-Off" duplicate bug ──
Deno.test("a moved instance (RECURRENCE-ID) is not double-emitted", () => {
  const master = {
    uid: "handoff",
    start: { date: new Date("2026-08-04T19:30:00Z"), allDay: false },
    end: { date: new Date("2026-08-04T20:30:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", BYDAY: "TU", WKST: "SU" },
    exdates: [],
  };
  const override = {
    uid: "handoff",
    start: { date: new Date("2026-08-11T17:00:00Z"), allDay: false }, // moved earlier
    end: { date: new Date("2026-08-11T18:00:00Z"), allDay: false },
    recurrenceId: new Date("2026-08-11T19:30:00Z"), // the original slot it replaces
    exdates: [],
  };
  const starts = applyRecurrenceOverrides([master, override])
    .flatMap((ev: any) =>
      expandOccurrences(ev, new Date("2026-08-03T00:00:00Z"), new Date("2026-08-17T00:00:00Z"))
    )
    .map((o: { start: Date }) => o.start.toISOString())
    .sort();
  // Aug 4 (untouched) + Aug 11 at the MOVED time only — never the original 19:30.
  assertEquals(starts, ["2026-08-04T19:30:00.000Z", "2026-08-11T17:00:00.000Z"]);
});

Deno.test("a cancelled instance (STATUS:CANCELLED override) is removed entirely", () => {
  const master = {
    uid: "cancelled-series",
    start: { date: new Date("2026-08-04T19:30:00Z"), allDay: false },
    end: { date: new Date("2026-08-04T20:30:00Z"), allDay: false },
    rrule: { FREQ: "WEEKLY", BYDAY: "TU", WKST: "SU" },
    exdates: [],
  };
  const cancellation = {
    uid: "cancelled-series",
    start: { date: new Date("2026-08-11T19:30:00Z"), allDay: false },
    end: { date: new Date("2026-08-11T20:30:00Z"), allDay: false },
    recurrenceId: new Date("2026-08-11T19:30:00Z"),
    status: "CANCELLED",
    exdates: [],
  };
  const starts = applyRecurrenceOverrides([master, cancellation])
    .flatMap((ev: any) =>
      expandOccurrences(ev, new Date("2026-08-03T00:00:00Z"), new Date("2026-08-17T00:00:00Z"))
    )
    .map((o: { start: Date }) => o.start.toISOString())
    .sort();
  // Only Aug 4 — the Aug 11 instance was cancelled, not moved.
  assertEquals(starts, ["2026-08-04T19:30:00.000Z"]);
});
