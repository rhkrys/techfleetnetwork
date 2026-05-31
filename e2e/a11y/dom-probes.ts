/**
 * In-page DOM probes for WCAG criteria that axe-core does NOT cover.
 *
 * Each probe is a function that runs *inside* the browser via
 * `page.evaluate(...)` and returns a normalized result object. Probes must
 * be self-contained (no imports, no closure variables) and synchronous
 * with respect to the DOM at call time.
 *
 * Probes return:
 *   { status: "pass" | "fail" | "needs_review", details?: string, samples?: string[] }
 *
 * Add a probe here, then reference its key from `wcag-checklist.ts`.
 */

export type ProbeStatus = "pass" | "fail" | "needs_review";
export interface ProbeResult {
  status: ProbeStatus;
  details?: string;
  samples?: string[];
}

/**
 * The probe table. Each value is a STRING containing a function body that
 * gets evaluated in the page. We use strings so the file can be imported
 * by Node without any browser globals leaking into type-checking.
 */
export const DOM_PROBES: Record<string, () => ProbeResult> = {
  "media-has-text-alternative": () => {
    const media = Array.from(document.querySelectorAll("audio, video"));
    if (media.length === 0) return { status: "pass", details: "No <audio>/<video> on page." };
    const missing = media.filter((el) => {
      const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title");
      const hasTrack = el.querySelector("track");
      const transcriptLink = el.parentElement?.querySelector('a[href*="transcript" i]');
      return !labelled && !hasTrack && !transcriptLink;
    });
    return missing.length
      ? { status: "needs_review", details: `${missing.length}/${media.length} media elements lack visible alt/track/transcript link.`, samples: missing.slice(0, 3).map((m) => m.outerHTML.slice(0, 200)) }
      : { status: "pass", details: `${media.length} media element(s) have an alternative reference.` };
  },

  "video-has-captions-track": () => {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return { status: "pass", details: "No <video> on page." };
    const missing = videos.filter((v) => !v.querySelector('track[kind="captions"], track[kind="subtitles"]'));
    return missing.length
      ? { status: "needs_review", details: `${missing.length}/${videos.length} videos missing <track kind="captions">.`, samples: missing.slice(0, 3).map((v) => v.outerHTML.slice(0, 200)) }
      : { status: "pass" };
  },

  "video-has-description-track": () => {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return { status: "pass", details: "No <video> on page." };
    const missing = videos.filter((v) => !v.querySelector('track[kind="descriptions"]') && !v.parentElement?.querySelector('a[href*="transcript" i], a[href*="description" i]'));
    return missing.length
      ? { status: "needs_review", details: `${missing.length}/${videos.length} videos lack a description track or linked transcript.` }
      : { status: "pass" };
  },

  "live-stream-has-captions": () => {
    // Live streams are typically embedded iframes (YouTube/Twitch/Zoom). We
    // surface them for human review rather than guess.
    const iframes = Array.from(document.querySelectorAll('iframe[src*="youtube"], iframe[src*="twitch"], iframe[src*="zoom"], iframe[src*="meet.google"]'));
    return iframes.length
      ? { status: "needs_review", details: `${iframes.length} live-capable embed(s) — verify captions are enabled in the source.` }
      : { status: "pass", details: "No live-stream embeds detected." };
  },

  "tabindex-not-positive": () => {
    const positive = Array.from(document.querySelectorAll("[tabindex]")).filter((el) => {
      const t = parseInt(el.getAttribute("tabindex") || "", 10);
      return Number.isFinite(t) && t > 0;
    });
    return positive.length
      ? { status: "fail", details: `${positive.length} element(s) use a positive tabindex (breaks DOM-based focus order).`, samples: positive.slice(0, 5).map((e) => e.outerHTML.slice(0, 150)) }
      : { status: "pass" };
  },

  "no-autoplay-audio-without-control": () => {
    const offenders = Array.from(document.querySelectorAll("audio[autoplay], video[autoplay]")).filter((el) => {
      const hasControls = el.hasAttribute("controls");
      const muted = el.hasAttribute("muted");
      const v = el as HTMLMediaElement;
      // Autoplay over 3s requires a control. Muted autoplay is allowed.
      return !muted && !hasControls && (v.duration === 0 || v.duration > 3);
    });
    return offenders.length
      ? { status: "fail", details: `${offenders.length} autoplaying media element(s) without controls or muting.`, samples: offenders.slice(0, 3).map((e) => e.outerHTML.slice(0, 200)) }
      : { status: "pass" };
  },

  "no-horizontal-scroll-at-320": () => {
    // Reflow check is performed at 320 CSS px — viewport is set by the
    // probe driver before invocation. We measure overflow at current width.
    const w = window.innerWidth;
    const scroll = document.documentElement.scrollWidth;
    return scroll - w > 1
      ? { status: "fail", details: `documentElement.scrollWidth (${scroll}) exceeds viewport (${w}) — horizontal scroll required.` }
      : { status: "pass", details: `No horizontal overflow at width ${w}.` };
  },

  "text-spacing-survives-overrides": () => {
    // Apply WCAG 1.4.12 overrides, then check no content is clipped.
    const style = document.createElement("style");
    style.id = "__wcag-text-spacing-probe__";
    style.textContent = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
    document.head.appendChild(style);
    // Allow layout to settle.
    void document.body.offsetHeight;
    const clipped = Array.from(document.querySelectorAll("p, h1, h2, h3, h4, button, a, label")).filter((el) => {
      const e = el as HTMLElement;
      return (e.scrollHeight > e.clientHeight + 1 && (getComputedStyle(e).overflow === "hidden")) ||
             (e.scrollWidth > e.clientWidth + 1 && (getComputedStyle(e).overflow === "hidden"));
    });
    style.remove();
    return clipped.length
      ? { status: "fail", details: `${clipped.length} element(s) clip content under WCAG text-spacing overrides.`, samples: clipped.slice(0, 5).map((e) => e.outerHTML.slice(0, 150)) }
      : { status: "pass" };
  },

  "tooltips-dismissable": () => {
    // Heuristic: any element with role="tooltip" should be associated to a
    // trigger via aria-describedby and be dismissable (the WCAG-required
    // dismiss key is Esc). We can only check the wiring statically.
    const tooltips = Array.from(document.querySelectorAll('[role="tooltip"]'));
    if (tooltips.length === 0) return { status: "pass", details: "No tooltip role on page." };
    const orphaned = tooltips.filter((t) => {
      const id = t.id;
      return !id || !document.querySelector(`[aria-describedby~="${id}"]`);
    });
    return orphaned.length
      ? { status: "fail", details: `${orphaned.length} tooltip(s) not referenced by aria-describedby.`, samples: orphaned.slice(0, 3).map((t) => t.outerHTML.slice(0, 150)) }
      : { status: "pass" };
  },

  "tab-traversal-completes": () => {
    // A true keyboard-trap test requires driving Tab from the test runner
    // (see playwright probe wrapper). Here we just sanity-check that there
    // are no elements with explicit `onkeydown` blocking Tab.
    const blockers = Array.from(document.querySelectorAll("[onkeydown]")).filter((el) => {
      const handler = (el.getAttribute("onkeydown") || "").toLowerCase();
      return /\bkey\s*===?\s*['"]tab['"]|keycode\s*===?\s*9/.test(handler) && /preventdefault|return false/.test(handler);
    });
    return blockers.length
      ? { status: "needs_review", details: `${blockers.length} inline handler(s) appear to intercept Tab — verify focus can leave the widget.` }
      : { status: "pass", details: "No inline Tab interceptors detected. Full traversal verified by Playwright wrapper." };
  },

  "no-uncontrollable-moving-content": () => {
    const animated = Array.from(document.querySelectorAll("marquee, blink"));
    if (animated.length) return { status: "fail", details: `Forbidden tag(s): ${animated.map((e) => e.tagName).join(", ")}` };
    // Check long-running CSS animations on visible elements without a
    // pause/stop control nearby.
    const longAnims = Array.from(document.querySelectorAll("*")).filter((el) => {
      const cs = getComputedStyle(el as Element);
      const dur = parseFloat(cs.animationDuration || "0");
      const iter = cs.animationIterationCount;
      return dur > 5 && (iter === "infinite" || parseInt(iter, 10) > 1);
    }).slice(0, 5);
    return longAnims.length
      ? { status: "needs_review", details: `${longAnims.length} long-running animation(s); ensure a pause control exists if content is informative.`, samples: longAnims.slice(0, 3).map((e) => (e as Element).outerHTML.slice(0, 150)) }
      : { status: "pass" };
  },

  "focused-element-not-obscured": () => {
    // Best-effort: when nothing is focused, this is a structural check.
    // We confirm there is no fixed-position element large enough to fully
    // cover the viewport (common modal-overlay misuse) without role=dialog.
    const overlays = Array.from(document.querySelectorAll("*")).filter((el) => {
      const cs = getComputedStyle(el as Element);
      if (cs.position !== "fixed") return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      const fullscreen = r.width >= window.innerWidth - 4 && r.height >= window.innerHeight - 4;
      const role = el.getAttribute("role") || "";
      return fullscreen && role !== "dialog" && role !== "alertdialog" && cs.pointerEvents !== "none";
    });
    return overlays.length
      ? { status: "needs_review", details: `${overlays.length} fullscreen fixed overlay(s) without dialog role — verify focused content is never obscured.` }
      : { status: "pass" };
  },

  "target-size-minimum-24x24": () => {
    // WCAG 2.5.8 Target Size (Minimum) — interactive controls must be ≥24×24
    // CSS px unless they are inline within a sentence or sized by the user agent.
    const SELECTOR = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], input:not([type="hidden"]), select, textarea, summary';
    const candidates = Array.from(document.querySelectorAll(SELECTOR)) as HTMLElement[];
    const offenders: HTMLElement[] = [];
    for (const el of candidates) {
      // Skip hidden / disabled / inline-in-text controls
      if ((el as HTMLInputElement).disabled) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Inline link inside a paragraph/sentence is exempt per spec note.
      const parentTag = el.parentElement?.tagName.toLowerCase();
      if (el.tagName.toLowerCase() === "a" && (parentTag === "p" || parentTag === "li" || parentTag === "span")) continue;
      if (r.width < 24 || r.height < 24) offenders.push(el);
    }
    return offenders.length
      ? { status: "fail", details: `${offenders.length} control(s) below 24×24 CSS px (WCAG 2.5.8).`, samples: offenders.slice(0, 5).map((o) => o.outerHTML.slice(0, 200)) }
      : { status: "pass", details: `${candidates.length} interactive control(s) meet 24×24 minimum.` };
  },

  "html-lang-matches-locale": () => {
    // WCAG 3.1.1 — <html lang> must be set and reflect a real BCP-47 tag.
    const html = document.documentElement;
    const lang = html.getAttribute("lang");
    if (!lang) return { status: "fail", details: "<html> is missing the lang attribute." };
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) return { status: "fail", details: `<html lang="${lang}"> is not a valid BCP-47 tag.` };
    // dir must be set to ltr or rtl when lang is RTL
    const RTL = ["ar", "he", "fa", "ur", "ps", "sd", "yi"];
    const primary = lang.split("-")[0].toLowerCase();
    const dir = html.getAttribute("dir");
    if (RTL.includes(primary) && dir !== "rtl") {
      return { status: "fail", details: `lang="${lang}" requires dir="rtl" on <html>.` };
    }
    return { status: "pass", details: `<html lang="${lang}" dir="${dir ?? "ltr"}"> is valid.` };
  },

  "no-positive-tabindex": () => {
    // WCAG 2.4.3 Focus Order — positive tabindex breaks expected order.
    const offenders = Array.from(document.querySelectorAll("[tabindex]")).filter((el) => {
      const v = parseInt(el.getAttribute("tabindex") || "0", 10);
      return v > 0;
    });
    return offenders.length
      ? { status: "fail", details: `${offenders.length} element(s) use a positive tabindex (breaks focus order).`, samples: offenders.slice(0, 5).map((o) => (o as HTMLElement).outerHTML.slice(0, 200)) }
      : { status: "pass" };
  },

  "status-messages-use-live-region": () => {
    // Toasts and inline status nodes should declare a live region.
    const toastContainers = Array.from(document.querySelectorAll('[class*="toast" i], [data-sonner-toaster], [data-radix-toast-viewport]'));
    const offenders = toastContainers.filter((c) => {
      const live = c.getAttribute("aria-live") || c.querySelector("[aria-live]");
      const role = c.getAttribute("role") || "";
      return !live && !["status", "alert", "log"].includes(role);
    });
    return offenders.length
      ? { status: "fail", details: `${offenders.length} toast/status container(s) without aria-live or role=status/alert.` }
      : { status: "pass", details: `${toastContainers.length} status surface(s) checked.` };
  },
};
