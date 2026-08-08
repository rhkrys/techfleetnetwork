/**
 * Single port for class-curriculum reads/writes. All mutations route through
 * SECURITY DEFINER RPCs that enforce ownership + sanitization server-side.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  ClassCurriculumBundle,
  ClassModuleActionType,
  ClassModuleAttachment,
  ClassModuleItem,
  ClassModuleProgress,
  ClassModuleSection,
  ClassModuleStatus,
  ClassReleasePolicy,
  ClassReleaseSettings,
  LearnerCurriculum,
} from "../types";

/** Private bucket for lesson files (see 20260808160100 migration). */
const FILE_BUCKET = "class-module-files";

type Rpc = (
  name: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

/** Minimal structural view of the parts of the storage client we use. */
type StorageBucket = {
  upload: (path: string, file: File, opts?: unknown) => Promise<{ error: unknown }>;
  remove: (paths: string[]) => Promise<{ error: unknown }>;
  createSignedUrl: (
    path: string,
    expiresIn: number,
    opts?: { download?: boolean | string }
  ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
};
const storageFrom = (bucket: string): StorageBucket =>
  (supabase as unknown as { storage: { from: (b: string) => StorageBucket } }).storage.from(bucket);

function unwrap<T>({ data, error }: { data: unknown; error: unknown }): T {
  if (error) {
    const msg = (error as { message?: string })?.message ?? "Request failed";
    throw new Error(msg);
  }
  return data as T;
}

export const ClassCurriculumService = {
  async fetchBundle(classId: string): Promise<ClassCurriculumBundle> {
    const [sectionsRes, itemsRes] = await Promise.all([
      supabase
        .from("class_module_sections" as never)
        .select("*")
        .eq("class_id", classId)
        .order("position", { ascending: true }) as unknown as Promise<{
        data: ClassModuleSection[] | null;
        error: unknown;
      }>,
      supabase
        .from("class_module_items" as never)
        .select("*")
        .eq("class_id", classId)
        .order("position", { ascending: true }) as unknown as Promise<{
        data: ClassModuleItem[] | null;
        error: unknown;
      }>,
    ]);
    const sections = unwrap<ClassModuleSection[]>(sectionsRes) ?? [];
    const items = unwrap<ClassModuleItem[]>(itemsRes) ?? [];
    const itemsBySection: Record<string, ClassModuleItem[]> = {};
    for (const s of sections) itemsBySection[s.id] = [];
    for (const it of items) {
      (itemsBySection[it.section_id] ??= []).push(it);
    }
    return { sections, itemsBySection };
  },

  async fetchProgress(classId: string): Promise<ClassModuleProgress[]> {
    const res = (await supabase
      .from("class_module_progress" as never)
      .select("*")
      .eq("class_id", classId)) as unknown as {
      data: ClassModuleProgress[] | null;
      error: unknown;
    };
    return unwrap<ClassModuleProgress[]>(res) ?? [];
  },

  async upsertSection(input: {
    class_id: string;
    id?: string | null;
    title: string;
    summary?: string | null;
    status?: ClassModuleStatus;
  }): Promise<ClassModuleSection> {
    return unwrap<ClassModuleSection>(
      await rpc("upsert_class_section", {
        p_class_id: input.class_id,
        p_section_id: input.id ?? null,
        p_title: input.title,
        p_summary: input.summary ?? null,
        p_status: input.status ?? "draft",
      })
    );
  },

  async deleteSection(sectionId: string): Promise<void> {
    unwrap(await rpc("delete_class_section", { p_section_id: sectionId }));
  },

  async upsertItem(input: {
    section_id: string;
    id?: string | null;
    title: string;
    content_html?: string | null;
    video_url?: string | null;
    action_type?: ClassModuleActionType;
    duration_minutes?: number | null;
    required?: boolean;
    status?: ClassModuleStatus;
  }): Promise<ClassModuleItem> {
    return unwrap<ClassModuleItem>(
      await rpc("upsert_class_module_item", {
        p_section_id: input.section_id,
        p_item_id: input.id ?? null,
        p_title: input.title,
        p_content_html: input.content_html ?? null,
        p_video_url: input.video_url ?? null,
        p_action_type: input.action_type ?? "read",
        p_duration_minutes: input.duration_minutes ?? null,
        p_required: input.required ?? true,
        p_status: input.status ?? "draft",
      })
    );
  },

  async deleteItem(itemId: string): Promise<void> {
    unwrap(await rpc("delete_class_module_item", { p_item_id: itemId }));
  },

  async reorderSections(classId: string, orderedIds: string[]): Promise<void> {
    unwrap(await rpc("reorder_class_sections", { p_class_id: classId, p_ordered_ids: orderedIds }));
  },

  async reorderItems(sectionId: string, orderedIds: string[]): Promise<void> {
    unwrap(
      await rpc("reorder_class_module_items", {
        p_section_id: sectionId,
        p_ordered_ids: orderedIds,
      })
    );
  },

  async publishAll(classId: string): Promise<number> {
    return unwrap<number>(await rpc("publish_class_curriculum", { p_class_id: classId }));
  },

  async toggleCompletion(itemId: string, completed: boolean): Promise<ClassModuleProgress> {
    return unwrap<ClassModuleProgress>(
      await rpc("toggle_class_module_completion", { p_item_id: itemId, p_completed: completed })
    );
  },

  // ---- Curriculum Authoring v2 ---------------------------------------------

  /**
   * Learner read path (F1). The server resolves entitlement + release and omits
   * the body of locked items, so this is the ONLY read a learner performs —
   * never the raw tables. Editors/admins get the full curriculum for preview.
   */
  async fetchLearnerCurriculum(classId: string): Promise<LearnerCurriculum> {
    const data = unwrap<LearnerCurriculum>(
      await rpc("get_class_curriculum_for_learner", { p_class_id: classId })
    );
    return data ?? { sections: [] };
  },

  /** Read the class's release settings (owner/admin, via RLS on `classes`). */
  async fetchReleaseSettings(classId: string): Promise<ClassReleaseSettings> {
    const res = (await supabase
      .from("classes" as never)
      .select("release_policy, release_at, release_offset_days")
      .eq("id", classId)
      .maybeSingle()) as unknown as { data: ClassReleaseSettings | null; error: unknown };
    return (
      unwrap<ClassReleaseSettings>(res) ?? {
        release_policy: "all_at_once",
        release_at: null,
        release_offset_days: null,
      }
    );
  },

  async setReleasePolicy(input: {
    class_id: string;
    policy: ClassReleasePolicy;
    release_at?: string | null;
    offset_days?: number | null;
  }): Promise<void> {
    unwrap(
      await rpc("set_class_release_policy", {
        p_class_id: input.class_id,
        p_policy: input.policy,
        p_release_at: input.release_at ?? null,
        p_offset_days: input.offset_days ?? null,
      })
    );
  },

  /** Editor-side: list an item's attachments (owner/admin via RLS). */
  async fetchItemAttachments(itemId: string): Promise<ClassModuleAttachment[]> {
    const res = (await supabase
      .from("class_module_attachments" as never)
      .select("*")
      .eq("item_id", itemId)
      .order("position", { ascending: true })) as unknown as {
      data: ClassModuleAttachment[] | null;
      error: unknown;
    };
    return unwrap<ClassModuleAttachment[]>(res) ?? [];
  },

  async upsertLink(input: {
    item_id: string;
    id?: string | null;
    url: string;
    label?: string | null;
  }): Promise<ClassModuleAttachment> {
    return unwrap<ClassModuleAttachment>(
      await rpc("upsert_class_module_link", {
        p_item_id: input.item_id,
        p_attachment_id: input.id ?? null,
        p_url: input.url,
        p_label: input.label ?? null,
      })
    );
  },

  /**
   * Upload a file to the private bucket, then register it. The storage path is
   * scoped to class/item so the register RPC's IDOR guard can bind it; the
   * bucket also enforces the size + MIME limits (defence in depth). The server
   * re-validates MIME/size/path in register_class_module_file regardless.
   */
  async uploadFile(input: {
    class_id: string;
    item_id: string;
    file: File;
  }): Promise<ClassModuleAttachment> {
    const safeName = input.file.name.replace(/[^\w.-]+/g, "_").slice(0, 200);
    const path = `class/${input.class_id}/item/${input.item_id}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await storageFrom(FILE_BUCKET).upload(path, input.file, {
      contentType: input.file.type,
      upsert: false,
    });
    if (upErr) throw new Error((upErr as { message?: string })?.message ?? "Upload failed");
    return unwrap<ClassModuleAttachment>(
      await rpc("register_class_module_file", {
        p_item_id: input.item_id,
        p_storage_path: path,
        p_file_name: input.file.name,
        p_mime_type: input.file.type,
        p_size_bytes: input.file.size,
      })
    );
  },

  /** Delete an attachment row (authoritative) and, for files, the object too. */
  async deleteAttachment(attachmentId: string): Promise<void> {
    const path = unwrap<string | null>(
      await rpc("delete_class_module_attachment", { p_attachment_id: attachmentId })
    );
    if (path) {
      await storageFrom(FILE_BUCKET)
        .remove([path])
        .catch(() => undefined); // row is gone; a stray object is swept by orphan-reclamation
    }
  },

  /**
   * Short-lived signed URL for a private lesson file. `download: true` forces
   * Content-Disposition: attachment so a mislabeled upload can never be rendered
   * as HTML/JS in our origin (OWASP file-serving control). Storage RLS
   * (can_read_class_module_file) still gates on entitlement + release.
   */
  async signFile(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await storageFrom(FILE_BUCKET).createSignedUrl(
      storagePath,
      expiresInSeconds,
      {
        download: true,
      }
    );
    if (error || !data) {
      throw new Error((error as { message?: string })?.message ?? "Could not sign file");
    }
    return data.signedUrl;
  },
};
