/**
 * Single port for class-curriculum reads/writes. All mutations route through
 * SECURITY DEFINER RPCs that enforce ownership + sanitization server-side.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  ClassCurriculumBundle,
  ClassModuleActionType,
  ClassModuleItem,
  ClassModuleProgress,
  ClassModuleSection,
  ClassModuleStatus,
} from "../types";

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = ((supabase as unknown as { rpc: Rpc }).rpc).bind(supabase);

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
      (supabase
        .from("class_module_sections" as never)
        .select("*")
        .eq("class_id", classId)
        .order("position", { ascending: true })) as unknown as Promise<{
          data: ClassModuleSection[] | null;
          error: unknown;
        }>,
      (supabase
        .from("class_module_items" as never)
        .select("*")
        .eq("class_id", classId)
        .order("position", { ascending: true })) as unknown as Promise<{
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
      .eq("class_id", classId)) as unknown as { data: ClassModuleProgress[] | null; error: unknown };
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
      }),
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
      }),
    );
  },

  async deleteItem(itemId: string): Promise<void> {
    unwrap(await rpc("delete_class_module_item", { p_item_id: itemId }));
  },

  async reorderSections(classId: string, orderedIds: string[]): Promise<void> {
    unwrap(await rpc("reorder_class_sections", { p_class_id: classId, p_ordered_ids: orderedIds }));
  },

  async reorderItems(sectionId: string, orderedIds: string[]): Promise<void> {
    unwrap(await rpc("reorder_class_module_items", {
      p_section_id: sectionId,
      p_ordered_ids: orderedIds,
    }));
  },

  async publishAll(classId: string): Promise<number> {
    return unwrap<number>(await rpc("publish_class_curriculum", { p_class_id: classId }));
  },

  async toggleCompletion(itemId: string, completed: boolean): Promise<ClassModuleProgress> {
    return unwrap<ClassModuleProgress>(
      await rpc("toggle_class_module_completion", { p_item_id: itemId, p_completed: completed }),
    );
  },
};
