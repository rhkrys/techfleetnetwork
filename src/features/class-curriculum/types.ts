export type ClassModuleStatus = "draft" | "published" | "archived";
export type ClassModuleActionType = "read" | "watch" | "task";
export type ClassModuleVideoProvider =
  "youtube" | "vimeo" | "loom" | "google_meet" | "other" | "none";

export interface ClassModuleSection {
  id: string;
  class_id: string;
  title: string;
  summary: string | null;
  position: number;
  status: ClassModuleStatus;
  created_by: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassModuleItem {
  id: string;
  section_id: string;
  class_id: string;
  title: string;
  position: number;
  content_html: string | null;
  video_url: string | null;
  video_provider: ClassModuleVideoProvider;
  video_embed_url: string | null;
  action_type: ClassModuleActionType;
  duration_minutes: number | null;
  required: boolean;
  status: ClassModuleStatus;
  created_by: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassModuleProgress {
  user_id: string;
  item_id: string;
  class_id: string;
  completed: boolean;
  completed_at: string | null;
  updated_at: string;
}

export interface ClassCurriculumBundle {
  sections: ClassModuleSection[];
  itemsBySection: Record<string, ClassModuleItem[]>;
}

// ---- Curriculum Authoring v2 -----------------------------------------------

/** Per-class release policy (D2: one policy per class). */
export type ClassReleasePolicy =
  "all_at_once" | "by_date" | "after_previous_completion" | "relative_to_cohort_start";

export interface ClassReleaseSettings {
  release_policy: ClassReleasePolicy;
  /** ISO timestamp; set only when policy is 'by_date'. */
  release_at: string | null;
  /** set only when policy is 'relative_to_cohort_start'. */
  release_offset_days: number | null;
}

export type ClassModuleAttachmentKind = "file" | "link";

export interface ClassModuleAttachment {
  id: string;
  item_id: string;
  class_id: string;
  kind: ClassModuleAttachmentKind;
  position: number;
  url: string | null;
  label: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}

/**
 * Item shape returned by get_class_curriculum_for_learner — the server has
 * already resolved release and OMITTED the body of locked items, so a locked
 * item here carries only its title + availability, never content.
 */
export interface LearnerModuleItem {
  id: string;
  title: string;
  position: number;
  action_type: ClassModuleActionType;
  required: boolean;
  duration_minutes: number | null;
  released: boolean;
  available_at: string | null;
  content_html: string | null;
  video_embed_url: string | null;
  video_provider: ClassModuleVideoProvider | null;
  attachments: ClassModuleAttachment[];
}

export interface LearnerModuleSection {
  id: string;
  title: string;
  summary: string | null;
  position: number;
  items: LearnerModuleItem[];
}

export interface LearnerCurriculum {
  sections: LearnerModuleSection[];
}
