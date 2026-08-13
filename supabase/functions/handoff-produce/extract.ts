// No-truncation extraction helpers (Phase B2). The board content that grounds a hand-off can be
// large (competitor analyses, storyboards). Instead of truncating a component's source material,
// we (1) drop unfilled workshop-template noise, (2) chunk the real content to fit the model's
// budget, and (3) merge + dedupe the facts extracted from every chunk. This reads 100% of the
// work: the raw content is only ever seen by the cheap one-time extraction stage; the writers
// work off the compact merged fact base. Pure functions — unit-tested offline, no I/O.

/** Rough token estimate (~4 chars/token for English). Used only to size chunks, never billed. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Placeholder/instruction phrases that mark an UNFILLED workshop template (noise, not work). */
const TEMPLATE_MARKERS = [
  "takeaway takeaway",
  "describe an action item",
  "enter your project goals",
  "enter the task and the steps",
  "enter the sprint task",
  "enter other requirements",
  "one user group per",
  "copy this and use it every sprint",
  "in the space below",
  "rules of thumb",
  "template the client",
  "write down a summary of takeaways",
  // Workshop prompt / instruction scaffolding (the "Results / Write ideas about…" prompts).
  "summarize your results here",
  "write ideas that you can introduce",
  "write ideas that you can collect",
  "define ideas about how",
  "document ideas about how",
  "write out the ways we can measure",
  "you may have heard the phrase",
  "run the kpi workshop",
  "template link:",
  "manus -", // the MANUS AI-tool section labels
];

// AI-plugin (Resonote) auto-summary blocks lead with a topic emoji then bullet-restate other content.
// Match ANY emoji (Extended_Pictographic covers ⏳, 🌱, 🔄, … — not just a hardcoded range) OR a
// leading bullet (the "• …" continuation lines of a summary block).
const AI_SUMMARY_LEAD = /^\s*(\p{Extended_Pictographic}|•)/u;
const DATE_ONLY =
  /^[-\s]*(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}[-\s]*$/i;

/**
 * True when a section reads as an empty template rather than filled work: it is dominated by
 * placeholder/instruction phrases, or it is trivially short. Conservative on purpose — it only
 * drops sections that are clearly scaffolding, so real (even terse) content is always kept.
 */
export function looksLikeTemplate(text: string): boolean {
  const t = text.toLowerCase();
  const trimmed = t.replace(/\s+/g, " ").trim();
  if (trimmed.length < 40) return true; // a heading or a couple of stray words, no real content
  let hits = 0;
  for (const m of TEMPLATE_MARKERS) {
    // count repeated occurrences — a template repeats its placeholders many times
    let idx = trimmed.indexOf(m);
    while (idx !== -1) {
      hits++;
      idx = trimmed.indexOf(m, idx + m.length);
    }
  }
  // marker phrases make up a large share of a short-ish section => template scaffolding
  const markerChars = hits * 18; // avg marker length, rough
  return hits >= 3 && markerChars / trimmed.length > 0.25;
}

/** Bare placeholder lines that mean an UNFILLED template slot (not the team's work). */
const PLACEHOLDER_LINES = new Set([
  "enter here",
  "list here",
  "add your notes",
  "add a note",
  "type here",
  "takeaway",
  "describe an action item",
  "your answer here",
  "results", // a bare section sub-heading, not content
  "format",
  "example",
  "figjam",
  "code",
]);

/**
 * True when ONE item (a sticky, cell, or block, separated by blank lines) is unfilled template
 * scaffolding rather than real work. CONSERVATIVE: a terse but real sticky is kept; only clear
 * placeholders/instructions are dropped. This is finer-grained than looksLikeTemplate (which judges
 * a whole chunk) so a real sticky sitting next to "Enter here" scaffolding is NOT lost with it.
 */
export function isTemplateItem(item: string): boolean {
  const trimmed = item.trim();
  if (AI_SUMMARY_LEAD.test(trimmed)) return true; // Resonote AI auto-summary block (emoji-led)
  if (DATE_ONLY.test(trimmed)) return true; // a bare date label
  const t = item
    .toLowerCase()
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!t) return true;
  if (TEMPLATE_MARKERS.some((m) => t.includes(m))) return true;
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Unfilled grid: the same short placeholder line repeated ("Enter here" x N, "Takeaway" x N).
  if (lines.length >= 2 && new Set(lines).size === 1 && lines[0].length < 40) return true;
  // A single bare placeholder line.
  if (lines.length === 1 && PLACEHOLDER_LINES.has(lines[0])) return true;
  return false;
}

/**
 * Drop unfilled-template ITEMS (blank-line separated) while KEEPING real items, even terse ones.
 * Replaces the per-chunk template filter for the extractor so real work is never discarded just
 * because it shares a section with template scaffolding (the "reflections lost among placeholders"
 * bug). Items are already blank-line separated by the fetch layer (one board item per block).
 */
export function stripTemplateItems(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s && !isTemplateItem(s))
    .join("\n\n");
}

/**
 * Split text into chunks no larger than maxChars, breaking on paragraph/sentence boundaries so a
 * fact is never cut mid-thought. A small overlap keeps context across the seam. No content is
 * dropped — the concatenation of all chunks covers the whole input.
 */
export function chunkText(text: string, maxChars = 12000, overlap = 400): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean.length ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // prefer to break on a paragraph, then a sentence, then a space, within the last 20%
      const window = clean.slice(start, end);
      const floor = start + Math.floor(maxChars * 0.8);
      const para = clean.lastIndexOf("\n\n", end);
      const sent = clean.lastIndexOf(". ", end);
      const space = clean.lastIndexOf(" ", end);
      const brk = [para, sent, space].filter((i) => i >= floor).sort((a, b) => b - a)[0];
      if (brk && brk > start) end = brk;
      void window;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

/**
 * Merge facts from many chunks into one deduped list. Dedupe is case/whitespace-insensitive;
 * order is preserved (first occurrence wins). The cap is a runaway backstop ONLY — set high enough
 * that real content-rich components (a KPI board, a persona set) are NEVER truncated; the extractor's
 * job is to read 100% of the work. If the cap ever bites, the caller logs the dropped count so it is
 * never silent. (Was 60, which guillotined content-rich sections mid-way — a real bug.)
 */
export function mergeFacts(factLists: string[][], cap = 400): { facts: string[]; dropped: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const list of factLists) {
    for (const raw of list) {
      const fact = String(raw ?? "").trim();
      if (!fact) continue;
      total++;
      const key = fact.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
    }
  }
  const dropped = Math.max(0, out.length - cap);
  return { facts: out.slice(0, cap), dropped };
}

/** Normalize a fact to a bag of comparison tokens: lowercased, accent-folded, punctuation stripped,
 *  whitespace-split. Word ORDER and punctuation are discarded so "activity in Discord" and "Discord
 *  activity" compare equal, while distinct wording stays distinct. */
function normTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Jaccard overlap of two token sets: |A∩B| / |A∪B|, in [0,1]. 1 = same words, 0 = no shared words. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Stage 3.5 — collapse NEAR-duplicate facts while keeping every DISTINCT point. `mergeFacts` already
 * dropped exact (case/whitespace) repeats; this removes the reworded/reordered restatements of the
 * SAME point that survive it — e.g. the same KPI written on two boards with different word order or
 * punctuation. This is the durable replacement for the demo-only "keep the first N facts" cap: it
 * reduces volume by removing REPEATS, never by discarding distinct content.
 *
 * PURE + DETERMINISTIC — no model, no I/O. A dedup stage is a SAFETY stage: its one job is to be
 * non-lossy of distinct meaning, so it must be repeatable and conservative. An LLM here would risk
 * merging genuinely different points (the exact nuance loss we protect) and add cost/latency/failure.
 * Two guarantees make it safe:
 *   1. NON-LOSSY of distinct points: two facts merge only when their word sets overlap at or above
 *      `threshold` (default 0.8, high). Distinct points share far fewer words, so they never merge.
 *   2. NON-LOSSY of nuance within a dup: when two near-duplicates merge, the MORE COMPLETE one (more
 *      tokens) is kept, so the richer phrasing wins.
 * Order is preserved (first-seen position wins). Returns the count removed so the caller LOGS it —
 * never a silent drop, matching `mergeFacts`.
 */
export function dedupeFacts(
  facts: string[],
  threshold = 0.8
): { facts: string[]; dropped: number } {
  const kept: string[] = [];
  const keptTokens: Set<string>[] = [];
  let dropped = 0;
  for (const raw of facts) {
    const fact = String(raw ?? "").trim();
    if (!fact) continue;
    const toks = normTokens(fact);
    let dupIndex = -1;
    if (toks.size > 0) {
      for (let i = 0; i < kept.length; i++) {
        if (jaccard(toks, keptTokens[i]) >= threshold) {
          dupIndex = i;
          break;
        }
      }
    }
    if (dupIndex === -1) {
      kept.push(fact);
      keptTokens.push(toks);
    } else {
      dropped++;
      // Keep whichever near-duplicate carries more words, so no nuance is lost to the merge.
      if (toks.size > keptTokens[dupIndex].size) {
        kept[dupIndex] = fact;
        keptTokens[dupIndex] = toks;
      }
    }
  }
  return { facts: kept, dropped };
}
