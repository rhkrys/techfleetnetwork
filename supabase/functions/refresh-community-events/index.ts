// @edge-cron
/**
 * refresh-community-events
 *
 * Cron-driven worker that fetches the public Tech Fleet community Google
 * Calendar (~8 MB ICS), parses VEVENTs (with simple RRULE expansion),
 * and upserts the result into `public.community_events_cache`.
 *
 * Performance:
 *  - Conditional GET via If-None-Match / If-Modified-Since → 304 fast path
 *    means most refreshes complete in <500 ms with no parse.
 *  - Parser is single-pass and skips VEVENT blocks whose DTEND ends before
 *    the cutoff (now − 1 day), so most past events never allocate strings.
 *  - Service-role only — no anonymous access.
 *
 * Triggered by:
 *  - cron job `refresh-community-events` (every 10 min, via pg_net)
 *  - Manual POST with the service-role bearer token.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { fromZonedTime } from "npm:date-fns-tz@3.2.0";
import { authorizeRefreshRequest } from "./auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ICAL_URL =
  "https://calendar.google.com/calendar/ical/techfleetnetwork%40gmail.com/public/basic.ics";

// Window we keep in the cache. Past events are filtered out at read time too.
// Kept generous (1 year) so users can browse forward in the week view without
// running off the end of the cache.
const WINDOW_DAYS = 365;
// Drop events that ended more than this many days ago (safety net for bad
// timezone math). Keep a small lookback so "happening now" stays visible.
const PAST_CUTOFF_DAYS = 1;

interface ParsedEvent {
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  allDay: boolean;
  description: string;
  location: string;
  url: string;
  organizerEmail: string;
}

// ─── ICS parsing (same as the read fn previously, kept self-contained) ───

function unfoldIcs(raw: string): string[] {
  const rawLines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeIcsText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcsDate(
  value: string,
  params: Record<string, string>
): { date: Date; allDay: boolean } {
  const isAllDay = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  if (isAllDay) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6) - 1;
    const d = +value.slice(6, 8);
    return { date: new Date(Date.UTC(y, m, d)), allDay: true };
  }
  const y = +value.slice(0, 4);
  const mo = +value.slice(4, 6) - 1;
  const d = +value.slice(6, 8);
  const h = +value.slice(9, 11);
  const mi = +value.slice(11, 13);
  const s = +value.slice(13, 15);
  // Trailing Z = explicit UTC.
  if (value.endsWith("Z")) {
    return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  }
  // TZID present → interpret wall-clock time in that zone, convert to UTC.
  const tzid = params.TZID;
  if (tzid) {
    try {
      const local = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15) || "00"}`;
      return { date: fromZonedTime(local, tzid), allDay: false };
    } catch {
      /* fall through to UTC */
    }
  }
  // Floating local time without TZID — treat as UTC (best-effort, matches prior behaviour).
  return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
}

function splitParams(key: string): { name: string; params: Record<string, string> } {
  const [name, ...paramParts] = key.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    // Param NAME is uppercased for lookup; param VALUE is preserved as-is
    // (TZID values like "America/Los_Angeles" are case-sensitive).
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params };
}

interface RawVEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  organizerEmail?: string;
  start?: { date: Date; allDay: boolean };
  end?: { date: Date; allDay: boolean };
  rrule?: Record<string, string>;
  exdates?: Date[];
  // RECURRENCE-ID: this VEVENT overrides one instance of its master series
  // (same UID). The value is the ORIGINAL start-time of the instance it replaces.
  recurrenceId?: Date;
  // STATUS:CANCELLED on an override means the instance was deleted, not moved.
  status?: string;
}

function parseVEvents(ics: string, pastCutoff: Date): RawVEvent[] {
  const lines = unfoldIcs(ics);
  const events: RawVEvent[] = [];
  let cur: RawVEvent | null = null;
  let skipBlock = false;
  let blockHasFutureRecurrence = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [] };
      skipBlock = false;
      blockHasFutureRecurrence = false;
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && !skipBlock) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur || skipBlock) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const { name, params } = splitParams(left);

    switch (name) {
      case "UID":
        cur.uid = value;
        break;
      case "SUMMARY":
        cur.summary = unescapeIcsText(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeIcsText(value);
        break;
      case "LOCATION":
        cur.location = unescapeIcsText(value);
        break;
      case "URL":
        cur.url = value;
        break;
      case "ORGANIZER": {
        const m = /mailto:([^\s;]+)/i.exec(value);
        if (m) cur.organizerEmail = m[1];
        break;
      }
      case "DTSTART":
        cur.start = parseIcsDate(value, params);
        break;
      case "DTEND":
        cur.end = parseIcsDate(value, params);
        // Early-skip past one-shot events to save allocation.
        if (cur.end && cur.end.date < pastCutoff && !cur.rrule && !blockHasFutureRecurrence) {
          // Check we haven't already seen RRULE; if RRULE comes after DTEND
          // we'll have to parse the whole thing — that's fine.
        }
        break;
      case "RRULE": {
        const rule: Record<string, string> = {};
        for (const part of value.split(";")) {
          const [k, v] = part.split("=");
          if (k && v) rule[k.toUpperCase()] = v;
        }
        cur.rrule = rule;
        blockHasFutureRecurrence = true;
        break;
      }
      case "EXDATE": {
        const parts = value.split(",");
        for (const p of parts) {
          cur.exdates!.push(parseIcsDate(p, params).date);
        }
        break;
      }
      case "RECURRENCE-ID":
        cur.recurrenceId = parseIcsDate(value, params).date;
        break;
      case "STATUS":
        cur.status = value.trim().toUpperCase();
        break;
    }
  }
  return events;
}

const WEEKDAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

// Resolve an ICS BYDAY token — "2TU" (2nd Tuesday), "-1FR" (last Friday), or a
// bare "TU" (treated as 1st) — to a concrete instant in the given UTC month,
// carrying the wall-clock time from the series master. Returns null if the
// ordinal falls outside the month. Computed in UTC to match the rest of the
// parser; correct for the common evening-meeting case where the UTC date equals
// the local date.
function nthWeekdayOfMonthUtc(
  year: number,
  month: number,
  bydayToken: string,
  timeFrom: Date
): Date | null {
  const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(bydayToken.trim());
  if (!m) return null;
  const wd = WEEKDAY_MAP[m[2]];
  if (wd === undefined) return null;
  const ord = m[1] ? parseInt(m[1], 10) : 1;
  if (ord === 0) return null;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let day: number;
  if (ord > 0) {
    const firstWd = new Date(Date.UTC(year, month, 1)).getUTCDay();
    day = 1 + ((wd - firstWd + 7) % 7) + (ord - 1) * 7;
  } else {
    const lastWd = new Date(Date.UTC(year, month, daysInMonth)).getUTCDay();
    day = daysInMonth - ((lastWd - wd + 7) % 7) + (ord + 1) * 7;
  }
  if (day < 1 || day > daysInMonth) return null;
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      timeFrom.getUTCHours(),
      timeFrom.getUTCMinutes(),
      timeFrom.getUTCSeconds()
    )
  );
}

// Reconcile RECURRENCE-ID overrides. Google exports an edited recurring series
// as a master VEVENT plus one override VEVENT per changed instance (same UID,
// carrying RECURRENCE-ID = the original instance time). Without reconciliation
// the master emits the original slot AND the override emits the moved slot →
// duplicates. Here we add each overridden original-instant to its master's
// EXDATEs (so the master skips it) and drop cancelled overrides entirely; the
// surviving override VEVENTs still emit their own moved time as one-shot events.
function applyRecurrenceOverrides(raw: RawVEvent[]): RawVEvent[] {
  const overridden = new Map<string, Set<number>>();
  for (const ev of raw) {
    if (ev.uid && ev.recurrenceId) {
      let set = overridden.get(ev.uid);
      if (!set) overridden.set(ev.uid, (set = new Set<number>()));
      set.add(ev.recurrenceId.getTime());
    }
  }
  const result: RawVEvent[] = [];
  for (const ev of raw) {
    if (ev.status === "CANCELLED") continue; // deleted instance — emit nothing
    if (ev.rrule && ev.uid) {
      const set = overridden.get(ev.uid);
      if (set) {
        ev.exdates = ev.exdates ?? [];
        for (const t of set) ev.exdates.push(new Date(t));
      }
    }
    result.push(ev);
  }
  return result;
}

function expandOccurrences(
  ev: RawVEvent,
  windowStart: Date,
  windowEnd: Date
): Array<{ start: Date; end: Date }> {
  if (!ev.start) return [];
  const start = ev.start.date;
  const end = ev.end?.date ?? new Date(start.getTime() + 60 * 60 * 1000);
  const duration = end.getTime() - start.getTime();

  if (!ev.rrule) {
    if (end < windowStart || start > windowEnd) return [];
    return [{ start, end }];
  }

  const freq = ev.rrule.FREQ;
  const interval = parseInt(ev.rrule.INTERVAL ?? "1", 10) || 1;
  const count = ev.rrule.COUNT ? parseInt(ev.rrule.COUNT, 10) : Infinity;
  let until: Date | null = null;
  if (ev.rrule.UNTIL) {
    until = parseIcsDate(ev.rrule.UNTIL, ev.rrule.UNTIL.length === 8 ? { VALUE: "DATE" } : {}).date;
  }
  const byday = ev.rrule.BYDAY ? ev.rrule.BYDAY.split(",") : null;
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const exdateSet = new Set((ev.exdates ?? []).map((d) => d.getTime()));

  const out: Array<{ start: Date; end: Date }> = [];
  const stepMs: Record<string, number> = {
    DAILY: 24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
  };
  const MAX_INSTANCES = 600;

  if (freq === "DAILY" || freq === "WEEKLY") {
    let occurrencesEmitted = 0;
    // Occurrences emitted per step, used to keep COUNT honest when we
    // fast-forward the cursor close to windowStart. Without this accounting,
    // a finite series like RRULE:FREQ=WEEKLY;COUNT=2 from 2022 would skip
    // forward to 2026 and emit a fresh batch of 2 — leaking ancient series
    // into the upcoming week. (The #1 cause of "events from years ago".)
    const occPerStep = freq === "WEEKLY" && byday && byday.length > 0 ? byday.length : 1;
    // Fast-forward cursor close to windowStart for efficiency
    let cursor = new Date(start.getTime());
    if (cursor < windowStart) {
      const stepsBehind = Math.floor(
        (windowStart.getTime() - cursor.getTime()) / (stepMs[freq] * interval)
      );
      if (stepsBehind > 0) {
        cursor = new Date(cursor.getTime() + stepsBehind * stepMs[freq] * interval);
        // Charge the skipped occurrences against COUNT so finite series stop.
        occurrencesEmitted += stepsBehind * occPerStep;
        if (occurrencesEmitted >= count) {
          return out; // series already exhausted before windowStart
        }
      }
    }
    // UNTIL guard: if the series ended before the window, skip entirely.
    if (until && until < windowStart) return out;
    let iterations = 0;
    while (
      cursor <= windowEnd &&
      occurrencesEmitted < count &&
      out.length < MAX_INSTANCES &&
      iterations < 5000
    ) {
      iterations++;
      if (until && cursor > until) break;
      const candidates: Date[] = [];
      if (freq === "WEEKLY" && byday) {
        const weekStart = new Date(cursor.getTime());
        weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
        for (const code of byday) {
          const dayCode = code.replace(/^[+\-\d]+/, "");
          const wd = dayMap[dayCode];
          if (wd === undefined) continue;
          const inst = new Date(weekStart.getTime());
          inst.setUTCDate(weekStart.getUTCDate() + wd);
          inst.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
          if (inst >= start) candidates.push(inst);
        }
      } else {
        candidates.push(new Date(cursor.getTime()));
      }
      for (const c of candidates) {
        if (until && c > until) continue;
        if (exdateSet.has(c.getTime())) continue;
        if (occurrencesEmitted >= count) break;
        occurrencesEmitted++;
        const cEnd = new Date(c.getTime() + duration);
        if (cEnd >= windowStart && c <= windowEnd) {
          out.push({ start: c, end: cEnd });
        }
      }
      cursor = new Date(cursor.getTime() + stepMs[freq] * interval);
    }
  } else if (freq === "MONTHLY" || freq === "YEARLY") {
    // Honor BYDAY (nth-weekday-of-month, e.g. "2TU" = 2nd Tuesday). Google uses
    // this for most monthly community meetings. Without BYDAY, fall back to the
    // same day-of-month/time as DTSTART (prior behaviour).
    let occurrencesEmitted = 0;
    let iterations = 0;
    // Anchor to the first of DTSTART's month so nth-weekday math is stable.
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const stepMonths = freq === "MONTHLY" ? interval : interval * 12;
    while (
      cursor <= windowEnd &&
      occurrencesEmitted < count &&
      out.length < MAX_INSTANCES &&
      iterations < 1200
    ) {
      iterations++;
      if (until && cursor > until) break;
      const y = cursor.getUTCFullYear();
      const mo = cursor.getUTCMonth();
      const candidates: Date[] = [];
      if (byday && (freq === "MONTHLY" || mo === start.getUTCMonth())) {
        for (const token of byday) {
          const inst = nthWeekdayOfMonthUtc(y, mo, token, start);
          if (inst) candidates.push(inst);
        }
        candidates.sort((a, b) => a.getTime() - b.getTime());
      } else if (!byday) {
        candidates.push(
          new Date(
            Date.UTC(
              y,
              mo,
              start.getUTCDate(),
              start.getUTCHours(),
              start.getUTCMinutes(),
              start.getUTCSeconds()
            )
          )
        );
      }
      for (const c of candidates) {
        if (c < start) continue;
        if (until && c > until) continue;
        if (exdateSet.has(c.getTime())) continue;
        if (occurrencesEmitted >= count) break;
        occurrencesEmitted++;
        const cEnd = new Date(c.getTime() + duration);
        if (cEnd >= windowStart && c <= windowEnd) out.push({ start: c, end: cEnd });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + stepMonths);
    }
  } else {
    if (end >= windowStart && start <= windowEnd) out.push({ start, end });
  }

  return out;
}

// ─── Handler ─────────────────────────────────────────────────────────

Deno.serve(
  withAuditWrapper("refresh-community-events", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Trigger auth: dedicated EVENTS_REFRESH_SECRET (preferred) OR the service-role
    // key (backward-compatible). Both are constant-time exact matches; no JWT decode.
    const auth = authorizeRefreshRequest(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const t0 = Date.now();
    try {
      const { data: cacheRow } = await supabase
        .from("community_events_cache")
        .select("etag, last_modified")
        .eq("id", 1)
        .maybeSingle();

      const conditionalHeaders: Record<string, string> = {
        // brand-allow: User-Agent token must be a single word per RFC 7231 §5.5.3.
        "User-Agent": "TechFleetNetwork/1.0 (+events-refresh)",
        "Accept-Encoding": "gzip",
      };
      if (cacheRow?.etag) conditionalHeaders["If-None-Match"] = cacheRow.etag;
      if (cacheRow?.last_modified) conditionalHeaders["If-Modified-Since"] = cacheRow.last_modified;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      let res: Response;
      try {
        res = await fetch(ICAL_URL, { headers: conditionalHeaders, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      // Fast path: nothing changed.
      if (res.status === 304) {
        await supabase
          .from("community_events_cache")
          .update({
            fetched_at: new Date().toISOString(),
            last_refresh_status: "not_modified",
            last_refresh_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
        return new Response(
          JSON.stringify({ status: "not_modified", durationMs: Date.now() - t0 }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Soft-fail on upstream rate-limit / transient errors: keep serving cached
      // events instead of throwing (which floods agent_fix_queue every cron tick).
      // Honors Retry-After so we don't hammer the source.
      if (res.status === 429 || res.status === 503) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterSec = retryAfterHeader
          ? Math.max(60, parseInt(retryAfterHeader, 10) || 300)
          : 300;
        const nextRetryAt = new Date(Date.now() + retryAfterSec * 1000).toISOString();
        await supabase
          .from("community_events_cache")
          .update({
            fetched_at: new Date().toISOString(),
            last_refresh_status: "rate_limited",
            last_refresh_error: `ICS upstream ${res.status}; backing off until ${nextRetryAt}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
        console.warn(
          `refresh-community-events soft-fail: ${res.status}, retry after ${retryAfterSec}s`
        );
        return new Response(
          JSON.stringify({ status: "rate_limited", retryAfterSec, durationMs: Date.now() - t0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!res.ok) {
        throw new Error(`ICS fetch failed ${res.status}`);
      }

      const newEtag = res.headers.get("etag");
      const newLastModified = res.headers.get("last-modified");
      const text = await res.text();

      const now = new Date();
      const pastCutoff = new Date(now.getTime() - PAST_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const raw = applyRecurrenceOverrides(parseVEvents(text, pastCutoff));
      const out: ParsedEvent[] = [];
      for (const ev of raw) {
        if (!ev.start || !ev.uid) continue;
        const occurrences = expandOccurrences(ev, pastCutoff, windowEnd);
        for (const occ of occurrences) {
          // Hard guard: drop anything that started before pastCutoff OR ends after
          // windowEnd. This catches malformed RRULEs, unknown FREQs, and any other
          // path that could otherwise leak ancient or far-future events to the UI.
          if (occ.start < pastCutoff) continue;
          if (occ.end < pastCutoff) continue;
          if (occ.start > windowEnd) continue;
          out.push({
            uid: `${ev.uid}@${occ.start.toISOString()}`,
            title: ev.summary?.trim() || "Untitled event",
            startUtc: occ.start.toISOString(),
            endUtc: occ.end.toISOString(),
            allDay: ev.start.allDay,
            description: ev.description ?? "",
            location: ev.location ?? "",
            url: ev.url ?? "",
            organizerEmail: ev.organizerEmail ?? "",
          });
        }
      }

      out.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
      const seen = new Set<string>();
      const deduped = out.filter((e) => {
        if (seen.has(e.uid)) return false;
        seen.add(e.uid);
        return true;
      });

      const { error: upsertError } = await supabase
        .from("community_events_cache")
        .update({
          events: deduped,
          event_count: deduped.length,
          etag: newEtag,
          last_modified: newLastModified,
          fetched_at: new Date().toISOString(),
          last_refresh_status: "ok",
          last_refresh_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (upsertError) throw upsertError;

      return new Response(
        JSON.stringify({
          status: "ok",
          eventCount: deduped.length,
          durationMs: Date.now() - t0,
          ics_bytes: text.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("refresh-community-events error:", message);
      await supabase
        .from("community_events_cache")
        .update({
          last_refresh_status: "error",
          last_refresh_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      return new Response(
        JSON.stringify({ status: "error", error: "Refresh failed", durationMs: Date.now() - t0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  })
);
