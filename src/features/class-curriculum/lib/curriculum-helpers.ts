/**
 * Pure helpers for class-curriculum: reorder math + video provider parsing.
 * Kept logic-only so it's testable without touching React or the DB.
 *
 * NOTE: Server is the source of truth for video provider derivation
 * (see public.derive_class_module_video). This client helper is a mirror
 * used only for previewing the editor experience — never for security
 * decisions.
 */

export type VideoProvider = "youtube" | "vimeo" | "loom" | "google_meet" | "other" | "none";

export function previewVideoProvider(url: string | null | undefined): {
  provider: VideoProvider;
  embedUrl: string | null;
} {
  const u = (url ?? "").trim();
  if (!u) return { provider: "none", embedUrl: null };
  if (!/^https?:\/\//i.test(u)) return { provider: "other", embedUrl: null };

  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i);
  if (yt) return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}` };

  const vimeo = u.match(/vimeo\.com\/(?:video\/)?([0-9]+)/i);
  if (vimeo) return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` };

  const loom = u.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/i);
  if (loom) return { provider: "loom", embedUrl: `https://www.loom.com/embed/${loom[1]}` };

  if (/^https:\/\/meet\.google\.com\//i.test(u)) return { provider: "google_meet", embedUrl: u };

  return { provider: "other", embedUrl: null };
}

/**
 * Apply a single reorder move within an array of ids.
 * Mirrors the optimistic update the editor performs before calling
 * `reorder_class_*` RPCs. Pure & side-effect-free.
 */
export function reorderIds(ids: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return ids.slice();
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return ids.slice();
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Compute completion progress for a learner. */
export function computeProgress(items: { id: string; required: boolean }[], completedIds: Set<string>): {
  requiredTotal: number;
  requiredDone: number;
  percent: number;
} {
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => completedIds.has(i.id)).length;
  const percent = required.length === 0 ? 0 : Math.round((done / required.length) * 100);
  return { requiredTotal: required.length, requiredDone: done, percent };
}
