import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { safeHtmlSchema, safeRequiredTextSchema, safeUrlSchema } from "@/lib/validators/shared-input";
import { handleServiceError } from "@/lib/service-result";
import { linkifyHtml } from "@/lib/linkify";
import { normalizeRichTextHtml } from "@/lib/html";
import { isTransientError } from "@/lib/transient-error";

const log = createLogger("AnnouncementService");
const announcementTitleSchema = safeRequiredTextSchema("Title", 200);
const announcementBodySchema = safeHtmlSchema("Update body");
const mediaUrlSchema = safeUrlSchema("Media URL", 1000).nullable().optional();

export interface Announcement {
  id: string;
  title: string;
  body_html: string;
  video_url: string | null;
  audio_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  author_name?: string;
}

// Module-level + localStorage last-known-good cache (graceful degradation
// pattern, Part 2 §H2). Keyed by limit so the bell (5) and full updates page
// (50) keep separate caches. localStorage carries last-known-good across cold
// page loads with a 24h TTL.
const LKG_LS_PREFIX = "tfn.announcements.lkg.";
const LKG_TTL_MS = 24 * 60 * 60 * 1000;
const lastKnownGood = new Map<number, Announcement[]>();

function readLkgFromStorage(limit: number): Announcement[] | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LKG_LS_PREFIX + limit) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; rows: Announcement[] };
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > LKG_TTL_MS) return null;
    return Array.isArray(parsed.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}

function writeLkgToStorage(limit: number, rows: Announcement[]): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LKG_LS_PREFIX + limit,
      JSON.stringify({ savedAt: Date.now(), rows }),
    );
  } catch {
    /* quota or private-mode — non-fatal */
  }
}

export const AnnouncementService = {
  async list(limit = 50): Promise<Announcement[]> {
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body_html, video_url, audio_url, created_by, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Transient (network/5xx/connection) → degrade silently to last-known-good.
      // Reporter has its own escalate-after-N rule for query.announcements.* so
      // sustained outages still reach the triage queue.
      if (isTransientError(error)) {
        handleServiceError(error, {
          logger: log,
          action: "list.transient",
          message: `Transient announcement fetch failure (degraded): ${error.message}`,
          level: "warn",
        });
        return lastKnownGood.get(limit) ?? [];
      }
      // Structural (RLS / schema / auth) → throw so it surfaces in triage.
      handleServiceError(error, {
        logger: log,
        action: "list",
        message: `Failed to fetch announcements: ${error.message}`,
        throwMessage: "Failed to load announcements.",
      });
    }

    const rows = (data ?? []) as unknown as Announcement[];
    lastKnownGood.set(limit, rows);
    return rows;
  },

  async latest(limit = 5): Promise<Announcement[]> {
    return this.list(limit);
  },

  async create(title: string, bodyHtml: string, userId: string, videoUrl?: string | null, audioUrl?: string | null): Promise<Announcement> {
    const linkified = linkifyHtml(normalizeRichTextHtml(bodyHtml));
    const row: Record<string, unknown> = { title: announcementTitleSchema.parse(title), body_html: announcementBodySchema.parse(linkified), created_by: userId };
    const safeVideoUrl = mediaUrlSchema.parse(videoUrl);
    const safeAudioUrl = mediaUrlSchema.parse(audioUrl);
    if (safeVideoUrl) row.video_url = safeVideoUrl;
    if (safeAudioUrl) row.audio_url = safeAudioUrl;
    const { data, error } = await supabase
      .from("announcements")
      .insert(row as any)
      .select()
      // single-required: insert returns exactly one row
      .single();
    handleServiceError(error, { logger: log, action: "create", message: `Failed to create announcement: ${error?.message ?? "Unknown error"}`, throwMessage: "We couldn't post that announcement. Please try again." });
    return data as unknown as Announcement;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);
    handleServiceError(error, { logger: log, action: "remove", message: `Failed to delete announcement: ${error?.message ?? "Unknown error"}`, throwMessage: "We couldn't delete that announcement. Please try again." });
  },

  async sendNotifications(announcementId: string): Promise<void> {
    const { getCachedSession } = await import("@/lib/cached-session");
    const session = await getCachedSession();
    if (!session) throw new Error("Not authenticated");
    const { error } = await supabase.functions.invoke("send-announcement-email", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { announcement_id: announcementId },
    });
    handleServiceError(error, { logger: log, action: "sendNotifications", message: `Email notification failed: ${error?.message ?? "Unknown error"}`, level: "warn" });
  },

  async getReadIds(userId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("announcement_reads")
      .select("announcement_id")
      .eq("user_id", userId);
    if (handleServiceError(error, { logger: log, action: "getReadIds", message: `Failed to fetch read IDs: ${error?.message ?? "Unknown error"}` })) return new Set();
    return new Set((data ?? []).map((r: any) => r.announcement_id));
  },

  async markRead(userId: string, announcementId: string): Promise<void> {
    const { error } = await supabase
      .from("announcement_reads")
      .insert({ user_id: userId, announcement_id: announcementId } as any)
      .select()
      .maybeSingle();
    if (error && !error.message.includes("duplicate")) handleServiceError(error, { logger: log, action: "markRead", message: `Failed to mark read: ${error.message}` });
  },

  /** Record a view (every click counts toward total views) */
  async recordView(userId: string, announcementId: string): Promise<void> {
    const { error } = await supabase
      .from("announcement_views")
      .insert({ user_id: userId, announcement_id: announcementId } as any);
    handleServiceError(error, { logger: log, action: "recordView", message: `Failed to record view: ${error?.message ?? "Unknown error"}`, level: "warn" });
  },

  /** Aggregated view counts (total + unique) for all announcements */
  async getViewCounts(): Promise<Map<string, { total: number; unique: number }>> {
    const { data, error } = await supabase.rpc("get_announcement_view_counts");
    if (handleServiceError(error, { logger: log, action: "getViewCounts", message: `Failed to fetch view counts: ${error?.message ?? "Unknown error"}`, level: "warn" })) return new Map();
    const map = new Map<string, { total: number; unique: number }>();
    for (const row of (data ?? []) as Array<{ announcement_id: string; total_views: number; unique_views: number }>) {
      map.set(row.announcement_id, { total: Number(row.total_views), unique: Number(row.unique_views) });
    }
    return map;
  },
};
