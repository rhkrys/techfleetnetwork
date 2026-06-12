/**
 * Runtime DOM translator.
 *
 * Why this exists: only a handful of components currently call `useTranslation()`,
 * yet users can pick any BCP-47 locale. Without this layer, switching languages
 * only updates `<html lang>` and a few keys — the visible UI stays in English.
 *
 * Strategy:
 *  - Walk visible text nodes under <body> (skipping inputs, code, scripts,
 *    aria-hidden icons, and `[data-no-translate]` subtrees).
 *  - Cache English source per node so we can re-translate when language changes.
 *  - Batch unique strings, debounce, then call the `translate-strings` edge fn.
 *  - Persist the (lang -> sourceHash -> translation) cache in localStorage so
 *    reloads are instant.
 *  - When language === "en", restore originals and detach observers — zero cost.
 *
 * This is a bridge: as components migrate to `t()`, those keys win because
 * source text matches and we still translate everything else for free.
 */
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "SVG",
  "PATH",
  "CIRCLE",
  "RECT",
  "POLYGON",
  "G",
  "DEFS",
  "USE",
  "TITLE",
]);

// Patterns we never translate: pure numbers, emails, URLs, hex codes, identifiers.
const SKIP_RE =
  /^(\s*[\d.,\-+%$€£¥/:]+\s*|\s*[A-Z0-9_-]+\s*|https?:\/\/\S+|mailto:\S+|[\w.+-]+@[\w.-]+\.\w+)$/i;

const STORAGE_PREFIX = "tf_dom_i18n:";
const MAX_CACHE_ENTRIES = 5000;
const BATCH_DEBOUNCE_MS = 250;
const MAX_BATCH = 150;

type TextRecord = { node: Text; original: string };

const state: {
  lang: string;
  observer: MutationObserver | null;
  // Original English text indexed by node — survives translation so we can
  // re-translate or revert when the language changes.
  records: WeakMap<Text, string>;
  // All currently-tracked nodes for this session (for re-walks on lang change).
  tracked: Set<Text>;
  // In-memory translation cache: lang -> source -> translated.
  cache: Map<string, Map<string, string>>;
  pending: Set<string>;
  flushTimer: number | null;
  inflight: boolean;
} = {
  lang: "en",
  observer: null,
  records: new WeakMap(),
  tracked: new Set(),
  cache: new Map(),
  pending: new Set(),
  flushTimer: null,
  inflight: false,
};

// React-volatile ARIA roles: regions React swaps text in/out of constantly.
// Translating these text nodes races React's reconciler and throws
// NotFoundError: removeChild (System Health 2026-06-11 AutosaveStatus regression).
const VOLATILE_ROLES = new Set(["status", "alert", "log", "timer"]);

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return false;
  let cur: Element | null = el;
  while (cur) {
    if (SKIP_TAGS.has(cur.tagName)) return true;
    if (cur.hasAttribute?.("data-no-translate")) return true;
    if (cur.hasAttribute?.("n")) return true; // legacy boolean opt-out (back-compat)
    if (cur.getAttribute?.("translate") === "no") return true;
    if (cur.getAttribute?.("aria-hidden") === "true") return true;
    if (cur.getAttribute?.("contenteditable") === "true") return true;
    // ARIA live regions are inherently React-volatile — never translate.
    const live = cur.getAttribute?.("aria-live");
    if (live === "polite" || live === "assertive") return true;
    const role = cur.getAttribute?.("role");
    if (role && VOLATILE_ROLES.has(role)) return true;
    cur = cur.parentElement;
  }
  return false;
}

function loadCacheFor(lang: string): Map<string, string> {
  if (state.cache.has(lang)) return state.cache.get(lang)!;
  const map = new Map<string, string>();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + lang);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") map.set(k, v);
      }
    }
  } catch {
    /* private mode / corrupt entry */
  }
  state.cache.set(lang, map);
  return map;
}

function persistCache(lang: string) {
  const map = state.cache.get(lang);
  if (!map) return;
  try {
    // Trim if oversized — drop oldest insertion order entries.
    if (map.size > MAX_CACHE_ENTRIES) {
      const keys = Array.from(map.keys()).slice(0, map.size - MAX_CACHE_ENTRIES);
      for (const k of keys) map.delete(k);
    }
    const obj: Record<string, string> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    localStorage.setItem(STORAGE_PREFIX + lang, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

function rememberOriginal(node: Text): string {
  const existing = state.records.get(node);
  if (existing !== undefined) return existing;
  const original = node.nodeValue ?? "";
  state.records.set(node, original);
  state.tracked.add(node);
  return original;
}

function applyTranslation(node: Text, source: string, lang: string) {
  if (lang === "en") {
    if (node.nodeValue !== source) setNodeValue(node, source);
    return;
  }
  const cache = loadCacheFor(lang);
  const trimmed = source.trim();
  const hit = cache.get(trimmed);
  if (hit !== undefined) {
    const lead = source.match(/^\s*/)?.[0] ?? "";
    const trail = source.match(/\s*$/)?.[0] ?? "";
    const next = `${lead}${hit}${trail}`;
    if (node.nodeValue !== next) setNodeValue(node, next);
  } else {
    queueForTranslation(trimmed);
  }
}

function queueForTranslation(source: string) {
  if (!source || SKIP_RE.test(source)) return;
  if (state.lang === "en") return;
  state.pending.add(source);
  scheduleFlush();
}

function scheduleFlush() {
  if (state.flushTimer != null) return;
  state.flushTimer = window.setTimeout(() => {
    state.flushTimer = null;
    void flush();
  }, BATCH_DEBOUNCE_MS);
}

async function flush() {
  if (state.inflight) {
    // Re-arm; another batch will pick up remaining work.
    if (state.pending.size > 0) scheduleFlush();
    return;
  }
  const lang = state.lang;
  if (lang === "en") {
    state.pending.clear();
    return;
  }
  const cache = loadCacheFor(lang);
  // Trim already-cached entries that snuck in between schedule and flush.
  const batch: string[] = [];
  for (const s of state.pending) {
    if (!cache.has(s)) batch.push(s);
    if (batch.length >= MAX_BATCH) break;
  }
  state.pending.clear();
  if (batch.length === 0) return;

  state.inflight = true;
  try {
    const { data, error } = await supabase.functions.invoke("translate-strings", {
      body: { locale: lang, strings: batch },
    });
    if (error || !data?.map) return;
    const map = data.map as Record<string, string>;
    for (const [src, tr] of Object.entries(map)) {
      cache.set(src, typeof tr === "string" ? tr : src);
    }
    persistCache(lang);
    // Re-apply to all tracked nodes whose source is in the new translations.
    for (const node of state.tracked) {
      const original = state.records.get(node);
      if (!original) continue;
      if (lang !== state.lang) break; // language switched mid-flight
      const trimmed = original.trim();
      if (map[trimmed] !== undefined) applyTranslation(node, original, lang);
    }
  } catch {
    /* network blip — next mutation will re-queue */
  } finally {
    state.inflight = false;
    if (state.pending.size > 0) scheduleFlush();
  }
}

// Wave 3 W3-DOM-007: chunk the walk via requestIdleCallback so language
// switches don't block the main thread (was 100–400ms long task on big pages).
const IDLE_CHUNK = 50;
type IdleHandle = number;
const ric: (cb: (deadline: { timeRemaining: () => number }) => void) => IdleHandle =
  (typeof window !== "undefined" && (window as any).requestIdleCallback)
    ? (window as any).requestIdleCallback.bind(window)
    : ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 1) as unknown as IdleHandle);

function walkAndTranslate(root: Node, lang: string) {
  if (root.nodeType === Node.TEXT_NODE) {
    const tn = root as Text;
    const parent = tn.parentElement;
    if (shouldSkipElement(parent)) return;
    const value = tn.nodeValue ?? "";
    if (!value.trim()) return;
    if (SKIP_RE.test(value.trim())) return;
    const original = rememberOriginal(tn);
    applyTranslation(tn, original, lang);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE && shouldSkipElement(root as Element)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const tn = n as Text;
      if (!tn.nodeValue || !tn.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (shouldSkipElement(tn.parentElement)) return NodeFilter.FILTER_REJECT;
      if (SKIP_RE.test(tn.nodeValue.trim())) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const collected: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    collected.push(cur as Text);
    cur = walker.nextNode();
  }
  // Bail out of chunking for tiny walks — no scheduler overhead.
  if (collected.length <= IDLE_CHUNK) {
    for (const tn of collected) {
      const original = rememberOriginal(tn);
      applyTranslation(tn, original, lang);
    }
    return;
  }
  let i = 0;
  const drain = () => {
    if (state.lang !== lang) return; // language changed mid-walk; abort
    const end = Math.min(i + IDLE_CHUNK, collected.length);
    for (; i < end; i++) {
      const tn = collected[i];
      const original = rememberOriginal(tn);
      applyTranslation(tn, original, lang);
    }
    if (i < collected.length) ric(drain);
  };
  ric(drain);
}


// Wave 1 PERF-W1-008: self-write guard set — every time we mutate a Text node
// ourselves we stamp it here so the MutationObserver callback can short-circuit.
const ownWrites = new WeakSet<Text>();

function setNodeValue(node: Text, value: string) {
  if (node.nodeValue === value) return;
  ownWrites.add(node);
  node.nodeValue = value;
}

function attachObserver() {
  if (state.observer) return;
  const obs = new MutationObserver((mutations) => {
    if (state.lang === "en") return;
    for (const m of mutations) {
      if (m.type === "characterData") {
        const tn = m.target as Text;
        if (ownWrites.has(tn)) { ownWrites.delete(tn); continue; }
        if (shouldSkipElement(tn.parentElement)) continue;
        const next = tn.nodeValue ?? "";
        state.records.set(tn, next);
        state.tracked.add(tn);
        if (next.trim() && !SKIP_RE.test(next.trim())) {
          applyTranslation(tn, next, state.lang);
        }
      } else if (m.type === "childList") {
        m.addedNodes.forEach((n) => walkAndTranslate(n, state.lang));
      }
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  state.observer = obs;
}

function detachObserver() {
  state.observer?.disconnect();
  state.observer = null;
}

function restoreAllToEnglish() {
  for (const node of state.tracked) {
    const original = state.records.get(node);
    if (original !== undefined && node.nodeValue !== original) {
      setNodeValue(node, original);
    }
  }
}

function setActiveLanguage(lang: string) {
  const normalized = (lang || "en").trim();
  state.lang = normalized;
  if (normalized.toLowerCase() === "en") {
    detachObserver();
    restoreAllToEnglish();
    // Wave 1 PERF-W1-008: drop tracked refs on en so we don't pin nodes for
    // the rest of the session. Re-walks will repopulate on next non-en switch.
    state.tracked = new Set();
    state.pending.clear();
    return;
  }
  loadCacheFor(normalized);
  attachObserver();
  walkAndTranslate(document.body, normalized);
}

let installed = false;
export function installDomTranslator() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const start = () => {
    setActiveLanguage(i18n.language || "en");
    i18n.on("languageChanged", (lng: string) => setActiveLanguage(lng));
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
