export type ClassModuleStatus = "draft" | "published" | "archived";
export type ClassModuleActionType = "read" | "watch" | "task";
export type ClassModuleVideoProvider =
  | "youtube"
  | "vimeo"
  | "loom"
  | "google_meet"
  | "other"
  | "none";

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
