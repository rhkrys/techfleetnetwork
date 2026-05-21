export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accessibility_training_completions: {
        Row: {
          completed_at: string
          id: string
          locale: string
          user_id: string
          version: string
        }
        Insert: {
          completed_at?: string
          id?: string
          locale?: string
          user_id: string
          version?: string
        }
        Update: {
          completed_at?: string
          id?: string
          locale?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      admin_banners: {
        Row: {
          body_html: string
          created_at: string
          created_by: string
          id: string
          reopen_after_dismiss: boolean
          status: Database["public"]["Enums"]["banner_status"]
          title: string
          updated_at: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          created_by: string
          id?: string
          reopen_after_dismiss?: boolean
          status?: Database["public"]["Enums"]["banner_status"]
          title: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          created_by?: string
          id?: string
          reopen_after_dismiss?: boolean
          status?: Database["public"]["Enums"]["banner_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_promotions: {
        Row: {
          confirmed_at: string | null
          created_at: string
          id: string
          prev_hash: string | null
          promoted_by: string
          row_hash: string | null
          token: string
          token_hash: string | null
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          prev_hash?: string | null
          promoted_by: string
          row_hash?: string | null
          token?: string
          token_hash?: string | null
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          prev_hash?: string | null
          promoted_by?: string
          row_hash?: string | null
          token?: string
          token_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent_fix_queue: {
        Row: {
          applied_at: string | null
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_reason: string | null
          error_message: string
          event_type: string
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          occurrence_count: number
          proposed_fix_files: Json
          proposed_fix_summary: string | null
          resolved_at: string | null
          root_cause_hypothesis: string | null
          sample_trace_id: string | null
          severity: string
          snoozed_until: string | null
          source: string
          status: string
          triage_cost_estimate_usd: number | null
          triage_model: string | null
          triage_tokens_in: number | null
          triage_tokens_out: number | null
          triaged_at: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          error_message: string
          event_type: string
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          occurrence_count?: number
          proposed_fix_files?: Json
          proposed_fix_summary?: string | null
          resolved_at?: string | null
          root_cause_hypothesis?: string | null
          sample_trace_id?: string | null
          severity?: string
          snoozed_until?: string | null
          source: string
          status?: string
          triage_cost_estimate_usd?: number | null
          triage_model?: string | null
          triage_tokens_in?: number | null
          triage_tokens_out?: number | null
          triaged_at?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          error_message?: string
          event_type?: string
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          occurrence_count?: number
          proposed_fix_files?: Json
          proposed_fix_summary?: string | null
          resolved_at?: string | null
          root_cause_hypothesis?: string | null
          sample_trace_id?: string | null
          severity?: string
          snoozed_until?: string | null
          source?: string
          status?: string
          triage_cost_estimate_usd?: number | null
          triage_model?: string | null
          triage_tokens_in?: number | null
          triage_tokens_out?: number | null
          triaged_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_triage_budget: {
        Row: {
          day: string
          id: number
          triage_calls_used: number
          updated_at: string
        }
        Insert: {
          day?: string
          id?: number
          triage_calls_used?: number
          updated_at?: string
        }
        Update: {
          day?: string
          id?: number
          triage_calls_used?: number
          updated_at?: string
        }
        Relationships: []
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_views: {
        Row: {
          announcement_id: string
          id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          announcement_id: string
          id?: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          announcement_id?: string
          id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audio_url: string | null
          body_html: string
          created_at: string
          created_by: string
          id: string
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          audio_url?: string | null
          body_html?: string
          created_at?: string
          created_by: string
          id?: string
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          audio_url?: string | null
          body_html?: string
          created_at?: string
          created_by?: string
          id?: string
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      audit_event_policy: {
        Row: {
          cap_per_minute: number
          dedup_window_seconds: number
          event_type_pattern: string
          id: string
          min_occurrences_before_escalate: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          cap_per_minute?: number
          dedup_window_seconds?: number
          event_type_pattern: string
          id?: string
          min_occurrences_before_escalate?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          cap_per_minute?: number
          dedup_window_seconds?: number
          event_type_pattern?: string
          id?: string
          min_occurrences_before_escalate?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          actor_email: string | null
          changed_fields: string[] | null
          created_at: string
          error_fingerprint: string | null
          error_message: string | null
          event_type: string
          id: string
          ip_address: string | null
          prev_hash: string | null
          record_id: string | null
          row_hash: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          actor_email?: string | null
          changed_fields?: string[] | null
          created_at?: string
          error_fingerprint?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          prev_hash?: string | null
          record_id?: string | null
          row_hash?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          actor_email?: string | null
          changed_fields?: string[] | null
          created_at?: string
          error_fingerprint?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          prev_hash?: string | null
          record_id?: string | null
          row_hash?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      badges_awarded: {
        Row: {
          awarded_at: string
          badge_code: string
          id: string
          metadata: Json
          source: string
          source_id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_code: string
          id?: string
          metadata?: Json
          source: string
          source_id: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_code?: string
          id?: string
          metadata?: Json
          source?: string
          source_id?: string
          user_id?: string
        }
        Relationships: []
      }
      banner_dismissals: {
        Row: {
          banner_id: string
          dismissed_at: string
          id: string
          user_id: string
        }
        Insert: {
          banner_id: string
          dismissed_at?: string
          id?: string
          user_id: string
        }
        Update: {
          banner_id?: string
          dismissed_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "banner_dismissals_banner_id_fkey"
            columns: ["banner_id"]
            isOneToOne: false
            referencedRelation: "admin_banners"
            referencedColumns: ["id"]
          },
        ]
      }
      bdd_scenarios: {
        Row: {
          created_at: string
          feature_area: string
          feature_area_number: number
          gherkin: string
          id: string
          notes: string | null
          scenario_id: string
          status: Database["public"]["Enums"]["bdd_status"]
          test_file: string | null
          test_type: Database["public"]["Enums"]["bdd_test_type"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_area: string
          feature_area_number: number
          gherkin: string
          id?: string
          notes?: string | null
          scenario_id: string
          status?: Database["public"]["Enums"]["bdd_status"]
          test_file?: string | null
          test_type?: Database["public"]["Enums"]["bdd_test_type"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_area?: string
          feature_area_number?: number
          gherkin?: string
          id?: string
          notes?: string | null
          scenario_id?: string
          status?: Database["public"]["Enums"]["bdd_status"]
          test_file?: string | null
          test_type?: Database["public"]["Enums"]["bdd_test_type"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          class_id: string
          created_at: string
          entity_id: string
          entity_type: string
          from_status: string | null
          id: string
          metadata: Json
          reason: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          class_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          class_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_audit_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_certifications: {
        Row: {
          airtable_record_id: string
          created_at: string
          display_title: string
          email: string
          id: string
          raw_data: Json
          synced_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          airtable_record_id: string
          created_at?: string
          display_title?: string
          email?: string
          id?: string
          raw_data?: Json
          synced_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          airtable_record_id?: string
          created_at?: string
          display_title?: string
          email?: string
          id?: string
          raw_data?: Json
          synced_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      class_followers: {
        Row: {
          class_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_followers_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          audiences: string
          created_at: string
          description: string | null
          hero_image_url: string | null
          id: string
          outcomes: string
          owner_user_id: string
          prerequisites: string[]
          published_at: string | null
          skills: string[]
          slug: string
          status: Database["public"]["Enums"]["class_status"]
          submitted_at: string | null
          summary: string
          title: string
          track: Database["public"]["Enums"]["class_track"]
          updated_at: string
          why_take: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          audiences?: string
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          outcomes?: string
          owner_user_id: string
          prerequisites?: string[]
          published_at?: string | null
          skills?: string[]
          slug: string
          status?: Database["public"]["Enums"]["class_status"]
          submitted_at?: string | null
          summary: string
          title: string
          track: Database["public"]["Enums"]["class_track"]
          updated_at?: string
          why_take?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          audiences?: string
          created_at?: string
          description?: string | null
          hero_image_url?: string | null
          id?: string
          outcomes?: string
          owner_user_id?: string
          prerequisites?: string[]
          published_at?: string | null
          skills?: string[]
          slug?: string
          status?: Database["public"]["Enums"]["class_status"]
          submitted_at?: string | null
          summary?: string
          title?: string
          track?: Database["public"]["Enums"]["class_track"]
          updated_at?: string
          why_take?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          created_at: string
          created_by: string
          id: string
          logo_url: string
          mission: string
          name: string
          primary_contact: string
          project_summary: string
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          website: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          logo_url?: string
          mission?: string
          name: string
          primary_contact?: string
          project_summary?: string
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          website?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          logo_url?: string
          mission?: string
          name?: string
          primary_contact?: string
          project_summary?: string
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          website?: string
        }
        Relationships: []
      }
      cohort_registrations: {
        Row: {
          cohort_id: string
          created_at: string
          id: string
          referrer: string | null
          user_id: string
        }
        Insert: {
          cohort_id: string
          created_at?: string
          id?: string
          referrer?: string | null
          user_id: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          id?: string
          referrer?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_registrations_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      cohorts: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          capacity: number | null
          class_id: string
          created_at: string
          end_date: string
          id: string
          label: string
          meeting_url: string | null
          published_at: string | null
          registration_url: string
          start_date: string
          status: Database["public"]["Enums"]["cohort_status"]
          submitted_at: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          capacity?: number | null
          class_id: string
          created_at?: string
          end_date: string
          id?: string
          label: string
          meeting_url?: string | null
          published_at?: string | null
          registration_url: string
          start_date: string
          status?: Database["public"]["Enums"]["cohort_status"]
          submitted_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          capacity?: number | null
          class_id?: string
          created_at?: string
          end_date?: string
          id?: string
          label?: string
          meeting_url?: string | null
          published_at?: string | null
          registration_url?: string
          start_date?: string
          status?: Database["public"]["Enums"]["cohort_status"]
          submitted_at?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohorts_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      community_agreement_signatures: {
        Row: {
          application_id: string
          id: string
          ip_address: unknown
          project_id: string
          signed_at: string
          user_agent: string | null
          user_id: string
          version_id: string
        }
        Insert: {
          application_id: string
          id?: string
          ip_address?: unknown
          project_id: string
          signed_at?: string
          user_agent?: string | null
          user_id: string
          version_id: string
        }
        Update: {
          application_id?: string
          id?: string
          ip_address?: unknown
          project_id?: string
          signed_at?: string
          user_agent?: string | null
          user_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_agreement_signatures_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "project_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_agreement_signatures_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "community_agreement_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      community_agreement_versions: {
        Row: {
          body_html: string
          created_at: string
          id: string
          is_current: boolean
          source_url: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          body_html: string
          created_at?: string
          id?: string
          is_current?: boolean
          source_url?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          is_current?: boolean
          source_url?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      community_events_cache: {
        Row: {
          etag: string | null
          event_count: number
          events: Json
          fetched_at: string | null
          id: number
          last_modified: string | null
          last_refresh_error: string | null
          last_refresh_status: string | null
          updated_at: string
        }
        Insert: {
          etag?: string | null
          event_count?: number
          events?: Json
          fetched_at?: string | null
          id?: number
          last_modified?: string | null
          last_refresh_error?: string | null
          last_refresh_status?: string | null
          updated_at?: string
        }
        Update: {
          etag?: string | null
          event_count?: number
          events?: Json
          fetched_at?: string | null
          id?: number
          last_modified?: string | null
          last_refresh_error?: string | null
          last_refresh_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cookie_consents: {
        Row: {
          anon_id: string | null
          categories: Json
          created_at: string
          gpc_signal: boolean
          id: string
          ip_country: string | null
          policy_version: string
          source: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          anon_id?: string | null
          categories: Json
          created_at?: string
          gpc_signal?: boolean
          id?: string
          ip_country?: string | null
          policy_version: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          anon_id?: string | null
          categories?: Json
          created_at?: string
          gpc_signal?: boolean
          id?: string
          ip_country?: string | null
          policy_version?: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      course_catalog: {
        Row: {
          active: boolean
          course_key: string
          created_at: string
          display_label: string
          display_order: number
          phase: Database["public"]["Enums"]["journey_phase"]
          tier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          course_key: string
          created_at?: string
          display_label: string
          display_order?: number
          phase: Database["public"]["Enums"]["journey_phase"]
          tier: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          course_key?: string
          created_at?: string
          display_label?: string
          display_order?: number
          phase?: Database["public"]["Enums"]["journey_phase"]
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_completion_stats: {
        Row: {
          computed_at: string
          course_key: string
          past_7d_completions: number
          total_completions: number
        }
        Insert: {
          computed_at?: string
          course_key: string
          past_7d_completions?: number
          total_completions?: number
        }
        Update: {
          computed_at?: string
          course_key?: string
          past_7d_completions?: number
          total_completions?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_completion_stats_course_key_fkey"
            columns: ["course_key"]
            isOneToOne: true
            referencedRelation: "course_catalog"
            referencedColumns: ["course_key"]
          },
        ]
      }
      course_completions: {
        Row: {
          completed_at: string
          course_key: string
          id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          course_key: string
          id?: string
          user_id: string
        }
        Update: {
          completed_at?: string
          course_key?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_completions_course_key_fkey"
            columns: ["course_key"]
            isOneToOne: false
            referencedRelation: "course_catalog"
            referencedColumns: ["course_key"]
          },
        ]
      }
      dashboard_preferences: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
          visible_widgets: Json
          widget_order: Json
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          visible_widgets?: Json
          widget_order?: Json
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          visible_widgets?: Json
          widget_order?: Json
        }
        Relationships: []
      }
      dead_client_sources: {
        Row: {
          added_at: string
          reason: string
          source: string
        }
        Insert: {
          added_at?: string
          reason: string
          source: string
        }
        Update: {
          added_at?: string
          reason?: string
          source?: string
        }
        Relationships: []
      }
      deleted_users_ledger: {
        Row: {
          deleted_at: string
          id: string
          jurisdiction: string | null
          purge_after: string
          user_id_hash: string
        }
        Insert: {
          deleted_at?: string
          id?: string
          jurisdiction?: string | null
          purge_after?: string
          user_id_hash: string
        }
        Update: {
          deleted_at?: string
          id?: string
          jurisdiction?: string | null
          purge_after?: string
          user_id_hash?: string
        }
        Relationships: []
      }
      device_binding_nonces: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          nonce: string
          purpose: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          nonce: string
          purpose: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          purpose?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      discord_guild_stats: {
        Row: {
          created_at: string
          fetched_at: string
          guild_id: string
          member_count: number
          presence_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          guild_id: string
          member_count?: number
          presence_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fetched_at?: string
          guild_id?: string
          member_count?: number
          presence_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      discord_role_grant_queue: {
        Row: {
          attempts: number
          created_at: string
          discord_user_id: string
          granted_at: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          reason: string
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          discord_user_id: string
          granted_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          reason?: string
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          discord_user_id?: string
          granted_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          reason?: string
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dispute_intake: {
        Row: {
          category: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          ip: unknown
          resolution_note: string | null
          resolved_at: string | null
          summary: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          ip?: unknown
          resolution_note?: string | null
          resolved_at?: string | null
          summary: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          ip?: unknown
          resolution_note?: string | null
          resolved_at?: string | null
          summary?: string
          user_id?: string | null
        }
        Relationships: []
      }
      dpa_executions: {
        Row: {
          client_id: string
          created_by: string | null
          id: string
          ip: unknown
          pdf_storage_path: string | null
          signed_at: string
          signed_by_email: string
          signed_by_name: string
          signed_by_title: string | null
          version: string
        }
        Insert: {
          client_id: string
          created_by?: string | null
          id?: string
          ip?: unknown
          pdf_storage_path?: string | null
          signed_at?: string
          signed_by_email: string
          signed_by_name: string
          signed_by_title?: string | null
          version?: string
        }
        Update: {
          client_id?: string
          created_by?: string | null
          id?: string
          ip?: unknown
          pdf_storage_path?: string | null
          signed_at?: string
          signed_by_email?: string
          signed_by_name?: string
          signed_by_title?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "dpa_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dsar_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          decision_notes: string | null
          due_at: string
          id: string
          jurisdiction: string | null
          parent_request_id: string | null
          payload: Json
          requester_email: string
          status: Database["public"]["Enums"]["dsar_status"]
          type: Database["public"]["Enums"]["dsar_type"]
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          decision_notes?: string | null
          due_at?: string
          id?: string
          jurisdiction?: string | null
          parent_request_id?: string | null
          payload?: Json
          requester_email: string
          status?: Database["public"]["Enums"]["dsar_status"]
          type: Database["public"]["Enums"]["dsar_type"]
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          decision_notes?: string | null
          due_at?: string
          id?: string
          jurisdiction?: string | null
          parent_request_id?: string | null
          payload?: Json
          requester_email?: string
          status?: Database["public"]["Enums"]["dsar_status"]
          type?: Database["public"]["Enums"]["dsar_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dsar_requests_parent_request_id_fkey"
            columns: ["parent_request_id"]
            isOneToOne: false
            referencedRelation: "dsar_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_health: {
        Row: {
          bounce_rate: number
          bounced_count: number
          complained_count: number
          complaint_rate: number
          created_at: string
          id: string
          recipient_domain: string
          sent_count: number
          window_end: string
          window_start: string
        }
        Insert: {
          bounce_rate?: number
          bounced_count?: number
          complained_count?: number
          complaint_rate?: number
          created_at?: string
          id?: string
          recipient_domain: string
          sent_count?: number
          window_end: string
          window_start: string
        }
        Update: {
          bounce_rate?: number
          bounced_count?: number
          complained_count?: number
          complaint_rate?: number
          created_at?: string
          id?: string
          recipient_domain?: string
          sent_count?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          bulk_hourly_cap: number
          bulk_paused: boolean
          bulk_warmup_started_at: string
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          bulk_hourly_cap?: number
          bulk_paused?: boolean
          bulk_warmup_started_at?: string
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          bulk_hourly_cap?: number
          bulk_paused?: boolean
          bulk_warmup_started_at?: string
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      error_digest_log: {
        Row: {
          audit_pressure: string | null
          channel: string
          delivered_at: string
          digest_key: string
          id: string
          payload: Json
          pending_count: number
          proposed_count: number
          recipient: string
        }
        Insert: {
          audit_pressure?: string | null
          channel: string
          delivered_at?: string
          digest_key: string
          id?: string
          payload?: Json
          pending_count?: number
          proposed_count?: number
          recipient: string
        }
        Update: {
          audit_pressure?: string | null
          channel?: string
          delivered_at?: string
          digest_key?: string
          id?: string
          payload?: Json
          pending_count?: number
          proposed_count?: number
          recipient?: string
        }
        Relationships: []
      }
      exploration_cache: {
        Row: {
          created_at: string
          hit_count: number
          id: string
          query_normalized: string
          response_markdown: string
        }
        Insert: {
          created_at?: string
          hit_count?: number
          id?: string
          query_normalized: string
          response_markdown?: string
        }
        Update: {
          created_at?: string
          hit_count?: number
          id?: string
          query_normalized?: string
          response_markdown?: string
        }
        Relationships: []
      }
      exploration_queries: {
        Row: {
          created_at: string
          id: string
          query_text: string
          result_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query_text: string
          result_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          query_text?: string
          result_count?: number
          user_id?: string
        }
        Relationships: []
      }
      failed_login_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: string
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          system_area: string
          user_email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          system_area?: string
          user_email?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          system_area?: string
          user_email?: string
          user_id?: string
        }
        Relationships: []
      }
      fleety_action_events: {
        Row: {
          action_label: string | null
          action_type: string
          id: string
          occurred_at: string
          target_url: string | null
          turn_id: string | null
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_type: string
          id?: string
          occurred_at?: string
          target_url?: string | null
          turn_id?: string | null
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_type?: string
          id?: string
          occurred_at?: string
          target_url?: string | null
          turn_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleety_action_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_signals_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleety_action_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_turn_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      fleety_canned_answers: {
        Row: {
          answer_md: string
          audience: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          question_pattern: string
          source_turn_id: string | null
          updated_at: string
        }
        Insert: {
          answer_md: string
          audience?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          question_pattern: string
          source_turn_id?: string | null
          updated_at?: string
        }
        Update: {
          answer_md?: string
          audience?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          question_pattern?: string
          source_turn_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleety_canned_answers_source_turn_id_fkey"
            columns: ["source_turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_signals_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleety_canned_answers_source_turn_id_fkey"
            columns: ["source_turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_turn_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      fleety_cost_counters: {
        Row: {
          cache_hits: number
          canned_hits: number
          est_usd: number
          hour_bucket: string
          model: string
          tier: string
          tokens_in: number
          tokens_out: number
          turns: number
        }
        Insert: {
          cache_hits?: number
          canned_hits?: number
          est_usd?: number
          hour_bucket: string
          model: string
          tier?: string
          tokens_in?: number
          tokens_out?: number
          turns?: number
        }
        Update: {
          cache_hits?: number
          canned_hits?: number
          est_usd?: number
          hour_bucket?: string
          model?: string
          tier?: string
          tokens_in?: number
          tokens_out?: number
          turns?: number
        }
        Relationships: []
      }
      fleety_cost_guard_state: {
        Row: {
          hard_threshold: number
          id: number
          medium_threshold: number
          mode: string
          notes: string | null
          soft_threshold: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          hard_threshold?: number
          id?: number
          medium_threshold?: number
          mode?: string
          notes?: string | null
          soft_threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          hard_threshold?: number
          id?: number
          medium_threshold?: number
          mode?: string
          notes?: string | null
          soft_threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      fleety_examples: {
        Row: {
          anonymized: boolean
          audience: string
          created_at: string
          created_by: string | null
          deliverable_type: string
          embedding: string | null
          embedding_updated_at: string | null
          excerpt: string
          id: string
          is_active: boolean
          related_playbook_slug: string | null
          slug: string
          source_url: string | null
          summary: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          anonymized?: boolean
          audience?: string
          created_at?: string
          created_by?: string | null
          deliverable_type: string
          embedding?: string | null
          embedding_updated_at?: string | null
          excerpt: string
          id?: string
          is_active?: boolean
          related_playbook_slug?: string | null
          slug: string
          source_url?: string | null
          summary: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          anonymized?: boolean
          audience?: string
          created_at?: string
          created_by?: string | null
          deliverable_type?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          excerpt?: string
          id?: string
          is_active?: boolean
          related_playbook_slug?: string | null
          slug?: string
          source_url?: string | null
          summary?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      fleety_kb_version: {
        Row: {
          id: boolean
          updated_at: string
          version: number
        }
        Insert: {
          id?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          id?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      fleety_message_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          playbook_slug: string | null
          rating: number
          reasons: string[]
          turn_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          playbook_slug?: string | null
          rating: number
          reasons?: string[]
          turn_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          playbook_slug?: string | null
          rating?: number
          reasons?: string[]
          turn_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleety_message_feedback_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_signals_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleety_message_feedback_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_turn_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      fleety_playbooks: {
        Row: {
          action_chips: Json
          ask_for_help: string | null
          audience: string
          common_pitfalls: string[]
          created_at: string
          created_by: string | null
          direct_answer: string
          done_criteria: string[]
          embedding: string | null
          embedding_updated_at: string | null
          example_artifact_url: string | null
          id: string
          intent: string
          is_active: boolean
          related_entity_slugs: string[]
          related_entity_types: string[]
          slug: string
          steps: Json
          tags: string[]
          title: string
          trigger_phrases: string[]
          updated_at: string
          when_to_use: string
        }
        Insert: {
          action_chips?: Json
          ask_for_help?: string | null
          audience?: string
          common_pitfalls?: string[]
          created_at?: string
          created_by?: string | null
          direct_answer: string
          done_criteria?: string[]
          embedding?: string | null
          embedding_updated_at?: string | null
          example_artifact_url?: string | null
          id?: string
          intent?: string
          is_active?: boolean
          related_entity_slugs?: string[]
          related_entity_types?: string[]
          slug: string
          steps?: Json
          tags?: string[]
          title: string
          trigger_phrases?: string[]
          updated_at?: string
          when_to_use: string
        }
        Update: {
          action_chips?: Json
          ask_for_help?: string | null
          audience?: string
          common_pitfalls?: string[]
          created_at?: string
          created_by?: string | null
          direct_answer?: string
          done_criteria?: string[]
          embedding?: string | null
          embedding_updated_at?: string | null
          example_artifact_url?: string | null
          id?: string
          intent?: string
          is_active?: boolean
          related_entity_slugs?: string[]
          related_entity_types?: string[]
          slug?: string
          steps?: Json
          tags?: string[]
          title?: string
          trigger_phrases?: string[]
          updated_at?: string
          when_to_use?: string
        }
        Relationships: []
      }
      fleety_prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          label: string
          notes: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          label: string
          notes?: string | null
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          label?: string
          notes?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      fleety_proposed_relationships: {
        Row: {
          created_at: string
          description: string
          from_entity: string
          id: string
          inverse_description: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_turn_id: string | null
          status: string
          to_entity: string
        }
        Insert: {
          created_at?: string
          description: string
          from_entity: string
          id?: string
          inverse_description?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_turn_id?: string | null
          status?: string
          to_entity: string
        }
        Update: {
          created_at?: string
          description?: string
          from_entity?: string
          id?: string
          inverse_description?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_turn_id?: string | null
          status?: string
          to_entity?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleety_proposed_relationships_source_turn_id_fkey"
            columns: ["source_turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_signals_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleety_proposed_relationships_source_turn_id_fkey"
            columns: ["source_turn_id"]
            isOneToOne: false
            referencedRelation: "fleety_turn_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      fleety_response_cache: {
        Row: {
          audience: string
          created_at: string
          hits: number
          kb_version: number
          last_turn_id: string | null
          last_used_at: string
          query_embedding: string | null
          query_hash: string
          query_text: string
          response_md: string
          sources: Json
          tier: string
        }
        Insert: {
          audience?: string
          created_at?: string
          hits?: number
          kb_version: number
          last_turn_id?: string | null
          last_used_at?: string
          query_embedding?: string | null
          query_hash: string
          query_text: string
          response_md: string
          sources?: Json
          tier?: string
        }
        Update: {
          audience?: string
          created_at?: string
          hits?: number
          kb_version?: number
          last_turn_id?: string | null
          last_used_at?: string
          query_embedding?: string | null
          query_hash?: string
          query_text?: string
          response_md?: string
          sources?: Json
          tier?: string
        }
        Relationships: []
      }
      fleety_topic_insights: {
        Row: {
          gap: boolean
          generated_at: string
          id: string
          label: string
          query_count: number
          sample_query: string
          thumbs_down: number
          thumbs_up: number
        }
        Insert: {
          gap?: boolean
          generated_at?: string
          id?: string
          label: string
          query_count?: number
          sample_query: string
          thumbs_down?: number
          thumbs_up?: number
        }
        Update: {
          gap?: boolean
          generated_at?: string
          id?: string
          label?: string
          query_count?: number
          sample_query?: string
          thumbs_down?: number
          thumbs_up?: number
        }
        Relationships: []
      }
      fleety_turn_signals: {
        Row: {
          audience: string
          canned_answer_id: string | null
          chips_clicked: number
          conversation_id: string | null
          created_at: string
          example_hits: number
          follow_up_within_60s: boolean | null
          framework_hit_count: number
          id: string
          intent: string | null
          kb_hit_count: number
          playbook_hits: number
          practical_score: number | null
          prompt_version: string | null
          response_ms: number | null
          user_id: string
          user_query: string
          web_hit_count: number
        }
        Insert: {
          audience?: string
          canned_answer_id?: string | null
          chips_clicked?: number
          conversation_id?: string | null
          created_at?: string
          example_hits?: number
          follow_up_within_60s?: boolean | null
          framework_hit_count?: number
          id?: string
          intent?: string | null
          kb_hit_count?: number
          playbook_hits?: number
          practical_score?: number | null
          prompt_version?: string | null
          response_ms?: number | null
          user_id: string
          user_query: string
          web_hit_count?: number
        }
        Update: {
          audience?: string
          canned_answer_id?: string | null
          chips_clicked?: number
          conversation_id?: string | null
          created_at?: string
          example_hits?: number
          follow_up_within_60s?: boolean | null
          framework_hit_count?: number
          id?: string
          intent?: string | null
          kb_hit_count?: number
          playbook_hits?: number
          practical_score?: number | null
          prompt_version?: string | null
          response_ms?: number | null
          user_id?: string
          user_query?: string
          web_hit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "fleety_turn_signals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      framework_edge_staging: {
        Row: {
          created_at: string
          dst_name: string
          dst_type: Database["public"]["Enums"]["framework_entity_type"] | null
          id: string
          rel_type: Database["public"]["Enums"]["framework_rel_type"] | null
          resolved_at: string | null
          source: string
          src_name: string | null
          src_type: Database["public"]["Enums"]["framework_entity_type"] | null
        }
        Insert: {
          created_at?: string
          dst_name: string
          dst_type?: Database["public"]["Enums"]["framework_entity_type"] | null
          id?: string
          rel_type?: Database["public"]["Enums"]["framework_rel_type"] | null
          resolved_at?: string | null
          source?: string
          src_name?: string | null
          src_type?: Database["public"]["Enums"]["framework_entity_type"] | null
        }
        Update: {
          created_at?: string
          dst_name?: string
          dst_type?: Database["public"]["Enums"]["framework_entity_type"] | null
          id?: string
          rel_type?: Database["public"]["Enums"]["framework_rel_type"] | null
          resolved_at?: string | null
          source?: string
          src_name?: string | null
          src_type?: Database["public"]["Enums"]["framework_entity_type"] | null
        }
        Relationships: []
      }
      framework_edges: {
        Row: {
          created_at: string
          dst_id: string
          dst_type: Database["public"]["Enums"]["framework_entity_type"]
          id: string
          rel_type: Database["public"]["Enums"]["framework_rel_type"]
          source: string
          src_id: string
          src_type: Database["public"]["Enums"]["framework_entity_type"]
          weight: number
        }
        Insert: {
          created_at?: string
          dst_id: string
          dst_type: Database["public"]["Enums"]["framework_entity_type"]
          id?: string
          rel_type: Database["public"]["Enums"]["framework_rel_type"]
          source?: string
          src_id: string
          src_type: Database["public"]["Enums"]["framework_entity_type"]
          weight?: number
        }
        Update: {
          created_at?: string
          dst_id?: string
          dst_type?: Database["public"]["Enums"]["framework_entity_type"]
          id?: string
          rel_type?: Database["public"]["Enums"]["framework_rel_type"]
          source?: string
          src_id?: string
          src_type?: Database["public"]["Enums"]["framework_entity_type"]
          weight?: number
        }
        Relationships: []
      }
      general_application_submissions: {
        Row: {
          application_id: string | null
          id: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          id?: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          id?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_application_submissions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "general_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      general_applications: {
        Row: {
          about_yourself: string
          agile_philosophies: string
          agile_vs_waterfall: string
          collaboration_challenges: string
          completed_at: string | null
          created_at: string
          current_section: number
          email: string
          hours_commitment: string
          id: string
          linkedin_url: string
          portfolio_url: string
          previous_engagement: string
          previous_engagement_ways: string[]
          psychological_safety: string
          servant_leadership_actions: string
          servant_leadership_challenges: string
          servant_leadership_definition: string
          servant_leadership_situation: string
          status: string
          teammate_learnings: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          about_yourself?: string
          agile_philosophies?: string
          agile_vs_waterfall?: string
          collaboration_challenges?: string
          completed_at?: string | null
          created_at?: string
          current_section?: number
          email?: string
          hours_commitment?: string
          id?: string
          linkedin_url?: string
          portfolio_url?: string
          previous_engagement?: string
          previous_engagement_ways?: string[]
          psychological_safety?: string
          servant_leadership_actions?: string
          servant_leadership_challenges?: string
          servant_leadership_definition?: string
          servant_leadership_situation?: string
          status?: string
          teammate_learnings?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          about_yourself?: string
          agile_philosophies?: string
          agile_vs_waterfall?: string
          collaboration_challenges?: string
          completed_at?: string | null
          created_at?: string
          current_section?: number
          email?: string
          hours_commitment?: string
          id?: string
          linkedin_url?: string
          portfolio_url?: string
          previous_engagement?: string
          previous_engagement_ways?: string[]
          psychological_safety?: string
          servant_leadership_actions?: string
          servant_leadership_challenges?: string
          servant_leadership_definition?: string
          servant_leadership_situation?: string
          status?: string
          teammate_learnings?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      grid_view_states: {
        Row: {
          created_at: string
          grid_id: string
          id: string
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          grid_id: string
          id?: string
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          grid_id?: string
          id?: string
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gumroad_sales: {
        Row: {
          email: string
          error_message: string | null
          id: string
          is_founding_member: boolean
          price_cents: number
          processed_at: string | null
          product_id: string
          product_permalink: string
          raw_payload: Json
          received_at: string
          recurrence: string
          resolved_tier: Database["public"]["Enums"]["membership_tier"] | null
          resolved_user_id: string | null
          sale_id: string
          seller_id: string
          status: string
        }
        Insert: {
          email: string
          error_message?: string | null
          id?: string
          is_founding_member?: boolean
          price_cents?: number
          processed_at?: string | null
          product_id?: string
          product_permalink?: string
          raw_payload?: Json
          received_at?: string
          recurrence?: string
          resolved_tier?: Database["public"]["Enums"]["membership_tier"] | null
          resolved_user_id?: string | null
          sale_id: string
          seller_id?: string
          status?: string
        }
        Update: {
          email?: string
          error_message?: string | null
          id?: string
          is_founding_member?: boolean
          price_cents?: number
          processed_at?: string | null
          product_id?: string
          product_permalink?: string
          raw_payload?: Json
          received_at?: string
          recurrence?: string
          resolved_tier?: Database["public"]["Enums"]["membership_tier"] | null
          resolved_user_id?: string | null
          sale_id?: string
          seller_id?: string
          status?: string
        }
        Relationships: []
      }
      handbooks: {
        Row: {
          category: string
          contents: string[]
          created_at: string
          description: string
          id: string
          link: string
          name: string
          target_audience: string
          updated_at: string
        }
        Insert: {
          category?: string
          contents?: string[]
          created_at?: string
          description?: string
          id?: string
          link?: string
          name: string
          target_audience?: string
          updated_at?: string
        }
        Update: {
          category?: string
          contents?: string[]
          created_at?: string
          description?: string
          id?: string
          link?: string
          name?: string
          target_audience?: string
          updated_at?: string
        }
        Relationships: []
      }
      i18n_translations: {
        Row: {
          created_at: string
          kb_version: number
          key: string
          locale: string
          machine_translated: boolean
          namespace: string
          source_hash: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          kb_version?: number
          key: string
          locale: string
          machine_translated?: boolean
          namespace: string
          source_hash: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          kb_version?: number
          key?: string
          locale?: string
          machine_translated?: boolean
          namespace?: string
          source_hash?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      incident_response: {
        Row: {
          affected_user_count: number
          created_at: string
          description: string
          draft_regulator_notice: string | null
          draft_user_notice: string | null
          id: string
          jurisdictions: string[]
          notification_due_at: string
          notified_regulators_at: string | null
          notified_users_at: string | null
          opened_by: string
          resolved_at: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          title: string
        }
        Insert: {
          affected_user_count?: number
          created_at?: string
          description: string
          draft_regulator_notice?: string | null
          draft_user_notice?: string | null
          id?: string
          jurisdictions?: string[]
          notification_due_at?: string
          notified_regulators_at?: string | null
          notified_users_at?: string | null
          opened_by: string
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          title: string
        }
        Update: {
          affected_user_count?: number
          created_at?: string
          description?: string
          draft_regulator_notice?: string | null
          draft_user_notice?: string | null
          id?: string
          jurisdictions?: string[]
          notification_due_at?: string
          notified_regulators_at?: string | null
          notified_users_at?: string | null
          opened_by?: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          title?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      journey_phase_definitions: {
        Row: {
          display_label: string | null
          phase: string
          required_tasks: number
          tier: string | null
          total_tasks: number
          updated_at: string
        }
        Insert: {
          display_label?: string | null
          phase: string
          required_tasks?: number
          tier?: string | null
          total_tasks?: number
          updated_at?: string
        }
        Update: {
          display_label?: string | null
          phase?: string
          required_tasks?: number
          tier?: string | null
          total_tasks?: number
          updated_at?: string
        }
        Relationships: []
      }
      journey_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          phase: Database["public"]["Enums"]["journey_phase"]
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          phase?: Database["public"]["Enums"]["journey_phase"]
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          phase?: Database["public"]["Enums"]["journey_phase"]
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_base: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          scraped_at: string
          title: string
          url: string
        }
        Insert: {
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          scraped_at?: string
          title?: string
          url: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          scraped_at?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      known_issue_catalog: {
        Row: {
          accepted_at: string
          accepted_by: string | null
          created_at: string
          event_type_filter: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          match_kind: string
          pattern: string
          reason: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string
          accepted_by?: string | null
          created_at?: string
          event_type_filter?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          match_kind?: string
          pattern: string
          reason: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string
          accepted_by?: string | null
          created_at?: string
          event_type_filter?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          match_kind?: string
          pattern?: string
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      lesson_catalog: {
        Row: {
          active: boolean
          course_key: string
          created_at: string
          display_order: number
          lesson_id: string
          phase: Database["public"]["Enums"]["journey_phase"]
          required: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          course_key: string
          created_at?: string
          display_order?: number
          lesson_id: string
          phase: Database["public"]["Enums"]["journey_phase"]
          required?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          course_key?: string
          created_at?: string
          display_order?: number
          lesson_id?: string
          phase?: Database["public"]["Enums"]["journey_phase"]
          required?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_catalog_course_key_fkey"
            columns: ["course_key"]
            isOneToOne: false
            referencedRelation: "course_catalog"
            referencedColumns: ["course_key"]
          },
        ]
      }
      milestone_reference: {
        Row: {
          activities: string[]
          created_at: string
          deliverables: string[]
          id: string
          milestone_name: string
          skills: string[]
        }
        Insert: {
          activities?: string[]
          created_at?: string
          deliverables?: string[]
          id?: string
          milestone_name: string
          skills?: string[]
        }
        Update: {
          activities?: string[]
          created_at?: string
          deliverables?: string[]
          id?: string
          milestone_name?: string
          skills?: string[]
        }
        Relationships: []
      }
      network_stats_baselines: {
        Row: {
          airtable_general_apps: number
          airtable_masterclass_total: number
          airtable_service_leadership_unique: number
          id: number
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          updated_at: string
        }
        Insert: {
          airtable_general_apps?: number
          airtable_masterclass_total?: number
          airtable_service_leadership_unique?: number
          id?: number
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Update: {
          airtable_general_apps?: number
          airtable_masterclass_total?: number
          airtable_service_leadership_unique?: number
          id?: number
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      network_stats_historical: {
        Row: {
          last_synced_at: string | null
          metric_key: string
          source: string
          synced_by: string | null
          updated_at: string
          value: number
        }
        Insert: {
          last_synced_at?: string | null
          metric_key: string
          source?: string
          synced_by?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          last_synced_at?: string | null
          metric_key?: string
          source?: string
          synced_by?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      network_stats_overrides: {
        Row: {
          metric_key: string
          reason: string | null
          updated_at: string
          updated_by: string | null
          value: number
        }
        Insert: {
          metric_key: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          value: number
        }
        Update: {
          metric_key?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: number
        }
        Relationships: []
      }
      network_stats_snapshots: {
        Row: {
          computed_at: string
          metric_key: string
          scope: string
          value: number
        }
        Insert: {
          computed_at?: string
          metric_key: string
          scope: string
          value?: number
        }
        Update: {
          computed_at?: string
          metric_key?: string
          scope?: string
          value?: number
        }
        Relationships: []
      }
      notification_dlq: {
        Row: {
          attempts: number
          body_html: string
          failed_at: string
          id: string
          last_error: string | null
          link_url: string
          notification_type: string
          outbox_id: string | null
          source: string
          title: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body_html?: string
          failed_at?: string
          id?: string
          last_error?: string | null
          link_url?: string
          notification_type?: string
          outbox_id?: string | null
          source?: string
          title: string
          user_id: string
        }
        Update: {
          attempts?: number
          body_html?: string
          failed_at?: string
          id?: string
          last_error?: string | null
          link_url?: string
          notification_type?: string
          outbox_id?: string | null
          source?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_fanout_jobs: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          next_offset: number
          payload: Json
          source: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_offset?: number
          payload: Json
          source: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_offset?: number
          payload?: Json
          source?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          body_html: string
          created_at: string
          delivered_at: string | null
          id: string
          last_error: string | null
          link_url: string
          next_attempt_at: string
          notification_type: string
          source: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body_html?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          link_url?: string
          next_attempt_at?: string
          notification_type?: string
          source?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body_html?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          link_url?: string
          next_attempt_at?: string
          notification_type?: string
          source?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body_html: string
          created_at: string
          id: string
          link_url: string
          notification_type: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          id?: string
          link_url?: string
          notification_type?: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          link_url?: string
          notification_type?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      observer_role_optins: {
        Row: {
          created_at: string
          discord_user_id: string
          last_error: string | null
          observers_role_granted_at: string | null
          opted_in_at: string
          projects_role_granted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discord_user_id: string
          last_error?: string | null
          observers_role_granted_at?: string | null
          opted_in_at?: string
          projects_role_granted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          discord_user_id?: string
          last_error?: string | null
          observers_role_granted_at?: string | null
          opted_in_at?: string
          projects_role_granted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      policy_acknowledgments: {
        Row: {
          accepted_at: string
          anon_id: string | null
          electronic_comms_consent: boolean
          id: string
          ip: unknown
          method: string
          policy_key: string
          user_agent: string | null
          user_id: string | null
          version: string
        }
        Insert: {
          accepted_at?: string
          anon_id?: string | null
          electronic_comms_consent?: boolean
          id?: string
          ip?: unknown
          method: string
          policy_key: string
          user_agent?: string | null
          user_id?: string | null
          version: string
        }
        Update: {
          accepted_at?: string
          anon_id?: string | null
          electronic_comms_consent?: boolean
          id?: string
          ip?: unknown
          method?: string
          policy_key?: string
          user_agent?: string | null
          user_id?: string | null
          version?: string
        }
        Relationships: []
      }
      policy_versions: {
        Row: {
          checksum: string
          created_at: string
          effective_at: string
          is_current: boolean
          policy_key: string
          version: string
        }
        Insert: {
          checksum: string
          created_at?: string
          effective_at?: string
          is_current?: boolean
          policy_key: string
          version: string
        }
        Update: {
          checksum?: string
          created_at?: string
          effective_at?: string
          is_current?: boolean
          policy_key?: string
          version?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string
          birth_day: number | null
          birth_month: number | null
          birth_year: number | null
          country: string
          country_code_at_signup: string | null
          created_at: string
          discord_invite_created_at: string | null
          discord_invite_url: string
          discord_user_id: string
          discord_username: string | null
          display_name: string
          education_background: string[]
          electronic_comms_consent_at: string | null
          email: string
          experience_areas: string[]
          first_name: string
          guardian_consent_at: string | null
          guardian_consent_token: string | null
          guardian_email: string | null
          has_discord_account: boolean
          id: string
          interests: string[]
          is_founding_member: boolean
          is_test_account: boolean
          last_name: string
          linkedin_url: string
          membership_billing_period: string
          membership_gumroad_sale_id: string
          membership_sku: string
          membership_tier: Database["public"]["Enums"]["membership_tier"]
          membership_updated_at: string | null
          notify_announcements: boolean
          notify_training_opportunities: boolean
          portfolio_url: string
          preferred_language: string
          professional_background: string
          professional_goals: string
          profile_completed: boolean
          scheduling_url: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          country?: string
          country_code_at_signup?: string | null
          created_at?: string
          discord_invite_created_at?: string | null
          discord_invite_url?: string
          discord_user_id?: string
          discord_username?: string | null
          display_name?: string
          education_background?: string[]
          electronic_comms_consent_at?: string | null
          email?: string
          experience_areas?: string[]
          first_name?: string
          guardian_consent_at?: string | null
          guardian_consent_token?: string | null
          guardian_email?: string | null
          has_discord_account?: boolean
          id?: string
          interests?: string[]
          is_founding_member?: boolean
          is_test_account?: boolean
          last_name?: string
          linkedin_url?: string
          membership_billing_period?: string
          membership_gumroad_sale_id?: string
          membership_sku?: string
          membership_tier?: Database["public"]["Enums"]["membership_tier"]
          membership_updated_at?: string | null
          notify_announcements?: boolean
          notify_training_opportunities?: boolean
          portfolio_url?: string
          preferred_language?: string
          professional_background?: string
          professional_goals?: string
          profile_completed?: boolean
          scheduling_url?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          country?: string
          country_code_at_signup?: string | null
          created_at?: string
          discord_invite_created_at?: string | null
          discord_invite_url?: string
          discord_user_id?: string
          discord_username?: string | null
          display_name?: string
          education_background?: string[]
          electronic_comms_consent_at?: string | null
          email?: string
          experience_areas?: string[]
          first_name?: string
          guardian_consent_at?: string | null
          guardian_consent_token?: string | null
          guardian_email?: string | null
          has_discord_account?: boolean
          id?: string
          interests?: string[]
          is_founding_member?: boolean
          is_test_account?: boolean
          last_name?: string
          linkedin_url?: string
          membership_billing_period?: string
          membership_gumroad_sale_id?: string
          membership_sku?: string
          membership_tier?: Database["public"]["Enums"]["membership_tier"]
          membership_updated_at?: string | null
          notify_announcements?: boolean
          notify_training_opportunities?: boolean
          portfolio_url?: string
          preferred_language?: string
          professional_background?: string
          professional_goals?: string
          profile_completed?: boolean
          scheduling_url?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_applications: {
        Row: {
          applicant_status: string
          client_project_knowledge: string
          community_agreement_required_at: string | null
          community_agreement_signed_at: string | null
          completed_at: string | null
          created_at: string
          cross_functional_contribution: string
          current_step: number
          id: string
          participated_previous_phase: boolean
          passion_for_project: string
          previous_phase_help_teammates: string
          previous_phase_learnings: string
          previous_phase_position: string
          prior_engagement_preparation: string
          project_id: string
          project_success_contribution: string
          status: string
          team_hats_interest: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          applicant_status?: string
          client_project_knowledge?: string
          community_agreement_required_at?: string | null
          community_agreement_signed_at?: string | null
          completed_at?: string | null
          created_at?: string
          cross_functional_contribution?: string
          current_step?: number
          id?: string
          participated_previous_phase?: boolean
          passion_for_project?: string
          previous_phase_help_teammates?: string
          previous_phase_learnings?: string
          previous_phase_position?: string
          prior_engagement_preparation?: string
          project_id: string
          project_success_contribution?: string
          status?: string
          team_hats_interest?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          applicant_status?: string
          client_project_knowledge?: string
          community_agreement_required_at?: string | null
          community_agreement_signed_at?: string | null
          completed_at?: string | null
          created_at?: string
          cross_functional_contribution?: string
          current_step?: number
          id?: string
          participated_previous_phase?: boolean
          passion_for_project?: string
          previous_phase_help_teammates?: string
          previous_phase_learnings?: string
          previous_phase_position?: string
          prior_engagement_preparation?: string
          project_id?: string
          project_success_contribution?: string
          status?: string
          team_hats_interest?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_blast_recipients: {
        Row: {
          blast_id: string
          created_at: string
          email_hash: string
          email_message_id: string | null
          email_status: string
          error: string | null
          id: string
          notification_id: string | null
          user_id: string
        }
        Insert: {
          blast_id: string
          created_at?: string
          email_hash: string
          email_message_id?: string | null
          email_status?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          user_id: string
        }
        Update: {
          blast_id?: string
          created_at?: string
          email_hash?: string
          email_message_id?: string | null
          email_status?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_blast_recipients_blast_id_fkey"
            columns: ["blast_id"]
            isOneToOne: false
            referencedRelation: "project_blasts"
            referencedColumns: ["id"]
          },
        ]
      }
      project_blasts: {
        Row: {
          audience_filter: Json
          body_html: string
          created_at: string
          email_failed_count: number
          email_sent_count: number
          email_suppressed_count: number
          error: string | null
          id: string
          notification_sent_count: number
          project_id: string
          recipient_count: number
          sender_id: string
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          audience_filter?: Json
          body_html: string
          created_at?: string
          email_failed_count?: number
          email_sent_count?: number
          email_suppressed_count?: number
          error?: string | null
          id?: string
          notification_sent_count?: number
          project_id: string
          recipient_count?: number
          sender_id: string
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          audience_filter?: Json
          body_html?: string
          created_at?: string
          email_failed_count?: number
          email_sent_count?: number
          email_suppressed_count?: number
          error?: string | null
          id?: string
          notification_sent_count?: number
          project_id?: string
          recipient_count?: number
          sender_id?: string
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_blasts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_certifications: {
        Row: {
          airtable_record_id: string
          created_at: string
          display_title: string
          email: string
          id: string
          raw_data: Json
          synced_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          airtable_record_id: string
          created_at?: string
          display_title?: string
          email?: string
          id?: string
          raw_data?: Json
          synced_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          airtable_record_id?: string
          created_at?: string
          display_title?: string
          email?: string
          id?: string
          raw_data?: Json
          synced_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_roster: {
        Row: {
          airtable_record_id: string
          client_name: string
          created_at: string
          end_date: string | null
          hours_contributed: number | null
          id: string
          linked_project_ids: string[]
          member_email: string
          member_name: string
          member_role: string
          mentor: string
          performance_notes: string
          phase: string
          project_id: string | null
          project_name: string
          project_type: string
          raw_airtable_data: Json | null
          start_date: string | null
          status: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          airtable_record_id: string
          client_name?: string
          created_at?: string
          end_date?: string | null
          hours_contributed?: number | null
          id?: string
          linked_project_ids?: string[]
          member_email?: string
          member_name?: string
          member_role?: string
          mentor?: string
          performance_notes?: string
          phase?: string
          project_id?: string | null
          project_name?: string
          project_type?: string
          raw_airtable_data?: Json | null
          start_date?: string | null
          status?: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          airtable_record_id?: string
          client_name?: string
          created_at?: string
          end_date?: string | null
          hours_contributed?: number | null
          id?: string
          linked_project_ids?: string[]
          member_email?: string
          member_name?: string
          member_role?: string
          mentor?: string
          performance_notes?: string
          phase?: string
          project_id?: string | null
          project_name?: string
          project_type?: string
          raw_airtable_data?: Json | null
          start_date?: string | null
          status?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_roster_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          anticipated_end_date: string | null
          anticipated_start_date: string | null
          client_id: string
          client_intake_url: string
          coordinator_id: string | null
          created_at: string
          created_by: string
          current_phase_milestones: string[]
          description: string
          discord_role_id: string
          discord_role_name: string
          friendly_name: string
          id: string
          notion_repository_url: string
          phase: Database["public"]["Enums"]["project_phase"]
          project_status: Database["public"]["Enums"]["project_status_enum"]
          project_type: Database["public"]["Enums"]["project_type"]
          requires_interview: boolean
          team_hats: string[]
          timezone_range: string
          updated_at: string
        }
        Insert: {
          anticipated_end_date?: string | null
          anticipated_start_date?: string | null
          client_id: string
          client_intake_url?: string
          coordinator_id?: string | null
          created_at?: string
          created_by: string
          current_phase_milestones?: string[]
          description?: string
          discord_role_id?: string
          discord_role_name?: string
          friendly_name?: string
          id?: string
          notion_repository_url?: string
          phase?: Database["public"]["Enums"]["project_phase"]
          project_status?: Database["public"]["Enums"]["project_status_enum"]
          project_type: Database["public"]["Enums"]["project_type"]
          requires_interview?: boolean
          team_hats?: string[]
          timezone_range?: string
          updated_at?: string
        }
        Update: {
          anticipated_end_date?: string | null
          anticipated_start_date?: string | null
          client_id?: string
          client_intake_url?: string
          coordinator_id?: string | null
          created_at?: string
          created_by?: string
          current_phase_milestones?: string[]
          description?: string
          discord_role_id?: string
          discord_role_name?: string
          friendly_name?: string
          id?: string
          notion_repository_url?: string
          phase?: Database["public"]["Enums"]["project_phase"]
          project_status?: Database["public"]["Enums"]["project_status_enum"]
          project_type?: Database["public"]["Enums"]["project_type"]
          requires_interview?: boolean
          team_hats?: string[]
          timezone_range?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quest_path_steps: {
        Row: {
          created_at: string
          description: string
          id: string
          linked_filter: Json | null
          linked_phase: string | null
          linked_table: string | null
          path_id: string
          sort_order: number
          step_type: Database["public"]["Enums"]["quest_step_type"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          linked_filter?: Json | null
          linked_phase?: string | null
          linked_table?: string | null
          path_id: string
          sort_order?: number
          step_type?: Database["public"]["Enums"]["quest_step_type"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          linked_filter?: Json | null
          linked_phase?: string | null
          linked_table?: string | null
          path_id?: string
          sort_order?: number
          step_type?: Database["public"]["Enums"]["quest_step_type"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quest_path_steps_path_id_fkey"
            columns: ["path_id"]
            isOneToOne: false
            referencedRelation: "quest_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_paths: {
        Row: {
          created_at: string
          description: string
          duration_phases: Json
          estimated_duration: string
          icon: string
          id: string
          level: string
          prerequisites: string[]
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          duration_phases?: Json
          estimated_duration?: string
          icon?: string
          id?: string
          level?: string
          prerequisites?: string[]
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          duration_phases?: Json
          estimated_duration?: string
          icon?: string
          id?: string
          level?: string
          prerequisites?: string[]
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          attempt_count: number
          blocked_until: string | null
          created_at: string
          id: string
          identifier: string
          window_start: string
        }
        Insert: {
          action: string
          attempt_count?: number
          blocked_until?: string | null
          created_at?: string
          id?: string
          identifier: string
          window_start?: string
        }
        Update: {
          action?: string
          attempt_count?: number
          blocked_until?: string | null
          created_at?: string
          id?: string
          identifier?: string
          window_start?: string
        }
        Relationships: []
      }
      recording_consents: {
        Row: {
          granted: boolean
          granted_at: string
          id: string
          revoke_reason: string | null
          revoked_at: string | null
          scope: string
          session_ref: string
          user_id: string
        }
        Insert: {
          granted?: boolean
          granted_at?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          scope: string
          session_ref: string
          user_id: string
        }
        Update: {
          granted?: boolean
          granted_at?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          scope?: string
          session_ref?: string
          user_id?: string
        }
        Relationships: []
      }
      reference_activities: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_agile_methods: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_company_types: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_deliverables: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_duties: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_job_functions: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_job_industries: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_job_specializations: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_job_titles: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_practices: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_project_milestones: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_projects: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_relationships: {
        Row: {
          all_descriptions: Json
          created_at: string
          description: string
          description_generated_at: string | null
          description_source: string
          from_entity: string
          id: string
          inverse_description: string | null
          is_active: boolean
          is_placeholder: boolean | null
          source: string
          to_entity: string
          updated_at: string
        }
        Insert: {
          all_descriptions?: Json
          created_at?: string
          description: string
          description_generated_at?: string | null
          description_source?: string
          from_entity: string
          id?: string
          inverse_description?: string | null
          is_active?: boolean
          is_placeholder?: boolean | null
          source?: string
          to_entity: string
          updated_at?: string
        }
        Update: {
          all_descriptions?: Json
          created_at?: string
          description?: string
          description_generated_at?: string | null
          description_source?: string
          from_entity?: string
          id?: string
          inverse_description?: string | null
          is_active?: boolean
          is_placeholder?: boolean | null
          source?: string
          to_entity?: string
          updated_at?: string
        }
        Relationships: []
      }
      reference_resources: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_skills: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_stakeholders: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_tech_job_categories: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_tools: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reference_workshops: {
        Row: {
          category: string
          created_at: string
          data: Json
          description: string
          description_generated_at: string | null
          description_source: string
          id: string
          is_active: boolean
          is_placeholder: boolean | null
          name: string
          search_tsv: unknown
          slug: string
          source: string
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name: string
          search_tsv?: unknown
          slug: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          data?: Json
          description?: string
          description_generated_at?: string | null
          description_source?: string
          id?: string
          is_active?: boolean
          is_placeholder?: boolean | null
          name?: string
          search_tsv?: unknown
          slug?: string
          source?: string
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      revoked_sessions: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          reason: string
          revoked_at: string
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          reason?: string
          revoked_at?: string
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          reason?: string
          revoked_at?: string
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sanctions_screenings: {
        Row: {
          country_code: string
          decision: string
          email: string | null
          id: string
          ip: unknown
          list_version: string
          reason: string | null
          screened_at: string
          user_id: string | null
        }
        Insert: {
          country_code: string
          decision: string
          email?: string | null
          id?: string
          ip?: unknown
          list_version: string
          reason?: string | null
          screened_at?: string
          user_id?: string | null
        }
        Update: {
          country_code?: string
          decision?: string
          email?: string | null
          id?: string
          ip?: unknown
          list_version?: string
          reason?: string | null
          screened_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string
          details: Json
          event_type: string
          id: string
          ip_address: string | null
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          ip_address?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          ip_address?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      signup_confirmation_reminders: {
        Row: {
          attempt_number: number
          created_at: string
          email: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          email: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          email?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stats_drift_log: {
        Row: {
          actual: number | null
          check_name: string
          details: Json | null
          detected_at: string
          expected: number | null
          id: string
        }
        Insert: {
          actual?: number | null
          check_name: string
          details?: Json | null
          detected_at?: string
          expected?: number | null
          id?: string
        }
        Update: {
          actual?: number | null
          check_name?: string
          details?: Json | null
          detected_at?: string
          expected?: number | null
          id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_health_state: {
        Row: {
          id: number
          metadata: Json
          pause_non_critical: boolean
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          id?: number
          metadata?: Json
          pause_non_critical?: boolean
          reason?: string
          status?: string
          updated_at?: string
        }
        Update: {
          id?: number
          metadata?: Json
          pause_non_critical?: boolean
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_remediations: {
        Row: {
          cooldown_seconds: number
          created_at: string
          description: string
          enabled: boolean
          event_type_filter: string | null
          id: string
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          remediation_function: string
          run_count: number
          signature_pattern: string
          success_count: number
          updated_at: string
        }
        Insert: {
          cooldown_seconds?: number
          created_at?: string
          description?: string
          enabled?: boolean
          event_type_filter?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          remediation_function: string
          run_count?: number
          signature_pattern: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          cooldown_seconds?: number
          created_at?: string
          description?: string
          enabled?: boolean
          event_type_filter?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          remediation_function?: string
          run_count?: number
          signature_pattern?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      teacher_promotions: {
        Row: {
          confirmed_at: string | null
          created_at: string
          id: string
          promoted_by: string
          token: string
          token_hash: string | null
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          promoted_by: string
          token?: string
          token_hash?: string | null
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          promoted_by?: string
          token?: string
          token_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      triage_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          fingerprint: string
          fix_queue_id: string
          from_status: string | null
          id: string
          matching_signal: string | null
          rule_name: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          fingerprint: string
          fix_queue_id: string
          from_status?: string | null
          id?: string
          matching_signal?: string | null
          rule_name: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          fingerprint?: string
          fix_queue_id?: string
          from_status?: string | null
          id?: string
          matching_signal?: string | null
          rule_name?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "triage_audit_log_fix_queue_id_fkey"
            columns: ["fix_queue_id"]
            isOneToOne: false
            referencedRelation: "agent_fix_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_audit_log_fix_queue_id_fkey"
            columns: ["fix_queue_id"]
            isOneToOne: false
            referencedRelation: "audit_triage_state"
            referencedColumns: ["fix_queue_id"]
          },
        ]
      }
      triage_critical_push_log: {
        Row: {
          fingerprint: string
          fix_queue_id: string | null
          id: string
          pushed_at: string
          reason: string
          recipients_count: number
        }
        Insert: {
          fingerprint: string
          fix_queue_id?: string | null
          id?: string
          pushed_at?: string
          reason: string
          recipients_count?: number
        }
        Update: {
          fingerprint?: string
          fix_queue_id?: string | null
          id?: string
          pushed_at?: string
          reason?: string
          recipients_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "triage_critical_push_log_fix_queue_id_fkey"
            columns: ["fix_queue_id"]
            isOneToOne: false
            referencedRelation: "agent_fix_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_critical_push_log_fix_queue_id_fkey"
            columns: ["fix_queue_id"]
            isOneToOne: false
            referencedRelation: "audit_triage_state"
            referencedColumns: ["fix_queue_id"]
          },
        ]
      }
      trusted_devices: {
        Row: {
          bound_at: string
          expires_at: string
          fingerprint: string
          id: string
          ip_address: string | null
          last_proof_at: string
          public_key: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          bound_at?: string
          expires_at?: string
          fingerprint: string
          id?: string
          ip_address?: string | null
          last_proof_at?: string
          public_key: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          bound_at?: string
          expires_at?: string
          fingerprint?: string
          id?: string
          ip_address?: string | null
          last_proof_at?: string
          public_key?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      two_factor_login_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          session_token_hash: string
          user_id: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          session_token_hash: string
          user_id: string
          verified_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          session_token_hash?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      user_quest_selections: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          last_nudged_at: string | null
          path_id: string
          started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_nudged_at?: string | null
          path_id: string
          started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_nudged_at?: string | null
          path_id?: string
          started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_quest_selections_path_id_fkey"
            columns: ["path_id"]
            isOneToOne: false
            referencedRelation: "quest_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      web_vital_samples: {
        Row: {
          browser_major: number | null
          browser_name: string | null
          connection_type: string | null
          created_at: string
          device_memory: number | null
          device_type: string | null
          id: string
          metric_name: string
          navigation_type: string | null
          os_major: number | null
          os_name: string | null
          rating: string
          route: string
          save_data: boolean | null
          user_agent: string | null
          user_id: string | null
          value: number
          viewport_h: number | null
          viewport_w: number | null
        }
        Insert: {
          browser_major?: number | null
          browser_name?: string | null
          connection_type?: string | null
          created_at?: string
          device_memory?: number | null
          device_type?: string | null
          id?: string
          metric_name: string
          navigation_type?: string | null
          os_major?: number | null
          os_name?: string | null
          rating: string
          route: string
          save_data?: boolean | null
          user_agent?: string | null
          user_id?: string | null
          value: number
          viewport_h?: number | null
          viewport_w?: number | null
        }
        Update: {
          browser_major?: number | null
          browser_name?: string | null
          connection_type?: string | null
          created_at?: string
          device_memory?: number | null
          device_type?: string | null
          id?: string
          metric_name?: string
          navigation_type?: string | null
          os_major?: number | null
          os_name?: string | null
          rating?: string
          route?: string
          save_data?: boolean | null
          user_agent?: string | null
          user_id?: string | null
          value?: number
          viewport_h?: number | null
          viewport_w?: number | null
        }
        Relationships: []
      }
      workshops: {
        Row: {
          accountable_function: string
          category: string
          company_types: string[]
          created_at: string
          deliverables: string
          description: string
          figma_link: string
          functions_involved: string[]
          id: string
          led_by: string
          milestones: string
          name: string
          project_types: string[]
          skills: string[]
          stakeholders: string[]
          timing: string
          updated_at: string
        }
        Insert: {
          accountable_function?: string
          category?: string
          company_types?: string[]
          created_at?: string
          deliverables?: string
          description?: string
          figma_link?: string
          functions_involved?: string[]
          id?: string
          led_by?: string
          milestones?: string
          name: string
          project_types?: string[]
          skills?: string[]
          stakeholders?: string[]
          timing?: string
          updated_at?: string
        }
        Update: {
          accountable_function?: string
          category?: string
          company_types?: string[]
          created_at?: string
          deliverables?: string
          description?: string
          figma_link?: string
          functions_involved?: string[]
          id?: string
          led_by?: string
          milestones?: string
          name?: string
          project_types?: string[]
          skills?: string[]
          stakeholders?: string[]
          timing?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      audit_log_decrypted: {
        Row: {
          changed_fields: string[] | null
          created_at: string | null
          error_fingerprint: string | null
          error_message: string | null
          event_type: string | null
          id: string | null
          ip_address: string | null
          record_id: string | null
          table_name: string | null
          user_id: string | null
        }
        Insert: {
          changed_fields?: string[] | null
          created_at?: string | null
          error_fingerprint?: string | null
          error_message?: string | null
          event_type?: string | null
          id?: string | null
          ip_address?: never
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Update: {
          changed_fields?: string[] | null
          created_at?: string | null
          error_fingerprint?: string | null
          error_message?: string | null
          event_type?: string | null
          id?: string | null
          ip_address?: never
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_triage_state: {
        Row: {
          audit_id: string | null
          error_fingerprint: string | null
          fix_queue_id: string | null
          silence_state: string | null
          triage_status: string | null
        }
        Relationships: []
      }
      email_health_snapshot: {
        Row: {
          bounced: number | null
          complained: number | null
          dlq: number | null
          frequency_capped: number | null
          rate_limited: number | null
          sent: number | null
          snapshot_at: string | null
          suppressed: number | null
          template_name: string | null
          total: number | null
        }
        Relationships: []
      }
      failed_login_attempts_decrypted: {
        Row: {
          attempted_at: string | null
          email: string | null
          id: string | null
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string | null
          email?: string | null
          id?: string | null
          ip_address?: never
          user_agent?: never
        }
        Update: {
          attempted_at?: string | null
          email?: string | null
          id?: string | null
          ip_address?: never
          user_agent?: never
        }
        Relationships: []
      }
      fleety_cost_daily: {
        Row: {
          cache_hits: number | null
          canned_hits: number | null
          day: string | null
          est_usd: number | null
          tokens_in: number | null
          tokens_out: number | null
          turns: number | null
        }
        Relationships: []
      }
      fleety_signals_view: {
        Row: {
          action_count: number | null
          audience: string | null
          canned_answer_id: string | null
          chips_clicked: number | null
          created_at: string | null
          example_hits: number | null
          feedback_reasons: string[] | null
          framework_hit_count: number | null
          id: string | null
          intent: string | null
          kb_hit_count: number | null
          playbook_hits: number | null
          practical_score: number | null
          prompt_version: string | null
          rating: number | null
          reason_count: number | null
          user_id: string | null
          user_query: string | null
          web_hit_count: number | null
        }
        Relationships: []
      }
      fleety_user_quota_daily: {
        Row: {
          turns_today: number | null
          user_id: string | null
        }
        Relationships: []
      }
      fleety_user_quota_monthly: {
        Row: {
          turns_this_month: number | null
          user_id: string | null
        }
        Relationships: []
      }
      framework_entity_v: {
        Row: {
          category: string | null
          data: Json | null
          description: string | null
          entity_type: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          slug: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      framework_node_neighbors_mv: {
        Row: {
          neighbors: Json | null
          node_id: string | null
          node_type: Database["public"]["Enums"]["framework_entity_type"] | null
        }
        Relationships: []
      }
      framework_search_mv: {
        Row: {
          description: string | null
          doc_tsv: unknown
          entity_type: string | null
          id: string | null
          name: string | null
          name_lc: string | null
          slug: string | null
        }
        Relationships: []
      }
      project_roster_member_view: {
        Row: {
          airtable_record_id: string | null
          client_name: string | null
          created_at: string | null
          end_date: string | null
          id: string | null
          linked_project_ids: string[] | null
          member_email: string | null
          member_name: string | null
          member_role: string | null
          phase: string | null
          project_id: string | null
          project_name: string | null
          project_type: string | null
          start_date: string | null
          status: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          airtable_record_id?: string | null
          client_name?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          linked_project_ids?: string[] | null
          member_email?: never
          member_name?: string | null
          member_role?: string | null
          phase?: string | null
          project_id?: string | null
          project_name?: string | null
          project_type?: string | null
          start_date?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          airtable_record_id?: string | null
          client_name?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          linked_project_ids?: string[] | null
          member_email?: never
          member_name?: string | null
          member_role?: string | null
          phase?: string | null
          project_id?: string | null
          project_name?: string | null
          project_type?: string | null
          start_date?: string | null
          status?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_roster_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _consume_device_nonce: {
        Args: { _nonce: string; _purpose: string; _user_id: string }
        Returns: boolean
      }
      _current_aal: { Args: never; Returns: string }
      admin_2fa_grace_active: { Args: { _user_id: string }; Returns: boolean }
      admin_2fa_grace_deadline: { Args: { _user_id: string }; Returns: string }
      admin_recompute_stats: { Args: never; Returns: Json }
      admin_reconcile_parity: { Args: never; Returns: Json }
      admin_set_test_account: {
        Args: { _is_test: boolean; _user_id: string }
        Returns: boolean
      }
      approve_and_publish_class: {
        Args: { p_class_id: string }
        Returns: undefined
      }
      archive_class: {
        Args: { p_class_id: string; p_reason: string }
        Returns: undefined
      }
      archive_old_fix_queue: { Args: never; Returns: number }
      bump_kb_version: { Args: never; Returns: number }
      cancel_cohort: {
        Args: { p_cohort_id: string; p_reason: string }
        Returns: undefined
      }
      check_chat_system_rate_limit: { Args: never; Returns: Json }
      check_fleety_user_quota: {
        Args: { _user_id: string }
        Returns: {
          allowed: boolean
          daily_limit: number
          daily_used: number
          monthly_limit: number
          monthly_used: number
          reason: string
        }[]
      }
      check_rate_limit: {
        Args: {
          p_action: string
          p_block_minutes?: number
          p_identifier: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: Json
      }
      claim_triage_budget: { Args: { p_cap?: number }; Returns: boolean }
      classify_triage_rule: {
        Args: { p_from_status: string; p_reason: string; p_to_status: string }
        Returns: string
      }
      cleanup_chunk_load_noise: { Args: never; Returns: Json }
      cleanup_rate_limits: { Args: never; Returns: number }
      cleanup_stuck_email_queue: { Args: never; Returns: number }
      cleanup_two_factor_login_artifacts: { Args: never; Returns: number }
      clear_rate_limits_for_email: {
        Args: { p_email: string }
        Returns: number
      }
      compute_email_domain_health: {
        Args: { p_since: string }
        Returns: {
          bounce_rate: number
          bounced: number
          complained: number
          complaint_rate: number
          sent: number
        }[]
      }
      compute_error_fingerprint: {
        Args: { p_event: string; p_msg: string; p_table: string }
        Returns: string
      }
      count_classes_pending_review: { Args: never; Returns: number }
      decrypt_pii: { Args: { cipher: string }; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      discover_audit_fingerprints: {
        Args: { p_min_occurrences?: number }
        Returns: {
          processed: number
          queued: number
          silenced: number
        }[]
      }
      drain_notification_fanout_jobs: {
        Args: {
          p_chunk_size?: number
          p_job_limit?: number
          p_max_chunks_per_job?: number
        }
        Returns: Json
      }
      drain_notification_outbox: { Args: { p_limit?: number }; Returns: Json }
      email_send_log_latest_failed: {
        Args: { p_since: string; p_template_name: string }
        Returns: {
          created_at: string
          error_message: string
          message_id: string
          status: string
        }[]
      }
      email_send_log_latest_stuck: {
        Args: { p_older_than: string; p_template_name: string }
        Returns: {
          created_at: string
          message_id: string
        }[]
      }
      encrypt_pii: { Args: { plain: string }; Returns: string }
      enforce_retention_policy: { Args: never; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      evaluate_system_health: {
        Args: never
        Returns: {
          id: number
          metadata: Json
          pause_non_critical: boolean
          reason: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "system_health_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      export_my_data: { Args: never; Returns: Json }
      fleety_approve_relationship: {
        Args: { p_id: string }
        Returns: undefined
      }
      fleety_cache_lookup: {
        Args: { _audience: string; _query_hash: string }
        Returns: {
          kb_version: number
          response_md: string
          sources: Json
          tier: string
        }[]
      }
      fleety_cache_record_hit: {
        Args: { _query_hash: string; _turn_id?: string }
        Returns: undefined
      }
      fleety_cache_semantic_lookup: {
        Args: {
          _audience: string
          _max_distance?: number
          _query_embedding: string
        }
        Returns: {
          query_hash: string
          response_md: string
          similarity: number
          sources: Json
          tier: string
        }[]
      }
      fleety_cache_store: {
        Args: {
          _audience: string
          _query_embedding?: string
          _query_hash: string
          _query_text: string
          _response_md: string
          _sources: Json
          _tier: string
          _turn_id?: string
        }
        Returns: undefined
      }
      fleety_cost_guard_step: { Args: never; Returns: string }
      fleety_cost_projection: {
        Args: never
        Returns: {
          cache_hit_rate: number
          canned_hit_rate: number
          guard_mode: string
          guard_step: string
          last_30d_usd: number
          last_7d_usd: number
          projected_30d_usd: number
          today_usd: number
          turns_today: number
          yesterday_usd: number
        }[]
      }
      fleety_few_shot_examples: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          assistant_response: string
          similarity: number
          thumbs_up: number
          user_query: string
        }[]
      }
      fleety_kb_semantic_search: {
        Args: { p_limit?: number; p_query_embedding: string }
        Returns: {
          content: string
          id: string
          similarity: number
          title: string
          url: string
        }[]
      }
      fleety_match_canned_answers: {
        Args: { p_audience?: string; p_limit?: number; p_query: string }
        Returns: {
          answer_md: string
          id: string
          question_pattern: string
          similarity: number
          thumbs_up: number
        }[]
      }
      fleety_match_examples: {
        Args: { p_limit?: number; p_playbook_slug?: string; p_query: string }
        Returns: {
          deliverable_type: string
          excerpt: string
          id: string
          similarity: number
          slug: string
          source_url: string
          summary: string
          title: string
        }[]
      }
      fleety_match_examples_semantic: {
        Args: { p_limit?: number; p_query_embedding: string }
        Returns: {
          deliverable_type: string
          excerpt: string
          id: string
          similarity: number
          slug: string
          source_url: string
          summary: string
          title: string
        }[]
      }
      fleety_match_playbooks: {
        Args: { p_audience?: string; p_limit?: number; p_query: string }
        Returns: {
          action_chips: Json
          ask_for_help: string
          common_pitfalls: string[]
          direct_answer: string
          done_criteria: string[]
          example_artifact_url: string
          id: string
          intent: string
          similarity: number
          slug: string
          steps: Json
          title: string
        }[]
      }
      fleety_match_playbooks_semantic: {
        Args: {
          p_audience?: string
          p_limit?: number
          p_query_embedding: string
        }
        Returns: {
          action_chips: Json
          ask_for_help: string
          common_pitfalls: string[]
          direct_answer: string
          done_criteria: string[]
          example_artifact_url: string
          id: string
          intent: string
          similarity: number
          slug: string
          steps: Json
          title: string
        }[]
      }
      fleety_playbooks_by_intent: {
        Args: { p_audience?: string; p_intent: string; p_limit?: number }
        Returns: {
          action_chips: Json
          ask_for_help: string
          common_pitfalls: string[]
          direct_answer: string
          done_criteria: string[]
          example_artifact_url: string
          id: string
          intent: string
          similarity: number
          slug: string
          steps: Json
          title: string
        }[]
      }
      fleety_promote_turn_to_canned: {
        Args: {
          _answer_md: string
          _audience?: string
          _question_pattern: string
          _turn_id: string
        }
        Returns: string
      }
      fleety_recompute_practical_scores: {
        Args: { p_days?: number }
        Returns: number
      }
      fleety_record_action: {
        Args: {
          p_action_label?: string
          p_action_type: string
          p_target_url?: string
          p_turn_id: string
        }
        Returns: string
      }
      fleety_record_cost: {
        Args: {
          _cache_hit: boolean
          _canned_hit: boolean
          _est_usd: number
          _model: string
          _tier: string
          _tokens_in: number
          _tokens_out: number
        }
        Returns: undefined
      }
      fleety_top_expensive_turns: {
        Args: { _limit?: number }
        Returns: {
          est_usd: number
          hits: number
          user_query: string
        }[]
      }
      fn_emit_badge: {
        Args: {
          _awarded_at?: string
          _badge_code: string
          _source: string
          _source_id: string
          _user_id: string
        }
        Returns: boolean
      }
      fn_evaluate_course_completion: {
        Args: { _lesson_id: string; _user_id: string }
        Returns: undefined
      }
      fw_build_entity_content: {
        Args: { p_description: string; p_entity: string; p_name: string }
        Returns: string
      }
      fw_delete_kb: { Args: { p_url: string }; Returns: undefined }
      fw_emit_edges_for_entity: {
        Args: {
          p_data: Json
          p_source?: string
          p_src_id: string
          p_src_type: Database["public"]["Enums"]["framework_entity_type"]
        }
        Returns: number
      }
      fw_entity_key_to_type: {
        Args: { p_key: string }
        Returns: Database["public"]["Enums"]["framework_entity_type"]
      }
      fw_label: { Args: { p_entity: string }; Returns: string }
      fw_lookup_relationships: {
        Args: { p_pairs: Json }
        Returns: {
          a: string
          b: string
          forward: string
          inverse: string
        }[]
      }
      fw_rebuild_all_edges: { Args: never; Returns: number }
      fw_refresh_neighbors_mv: { Args: never; Returns: undefined }
      fw_refresh_search_mv: { Args: never; Returns: undefined }
      fw_rename_jsonb_keys: {
        Args: { p_data: Json; p_pairs: string[] }
        Returns: Json
      }
      fw_replay_staging: {
        Args: never
        Returns: {
          remaining: number
          resolved: number
        }[]
      }
      fw_resolve_entity: {
        Args: {
          p_name: string
          p_type: Database["public"]["Enums"]["framework_entity_type"]
        }
        Returns: string
      }
      fw_slug: { Args: { input: string }; Returns: string }
      fw_split_dedupe: { Args: { p_value: string }; Returns: string[] }
      fw_sync_relationships_to_kb: { Args: never; Returns: number }
      fw_table_to_entity: {
        Args: { p_table: string }
        Returns: Database["public"]["Enums"]["framework_entity_type"]
      }
      fw_upsert_edge: {
        Args: {
          p_dst_name: string
          p_dst_type: Database["public"]["Enums"]["framework_entity_type"]
          p_rel: Database["public"]["Enums"]["framework_rel_type"]
          p_source?: string
          p_src_id: string
          p_src_type: Database["public"]["Enums"]["framework_entity_type"]
        }
        Returns: undefined
      }
      fw_upsert_kb: {
        Args: { p_content: string; p_title: string; p_url: string }
        Returns: undefined
      }
      get_announcement_view_counts: {
        Args: never
        Returns: {
          announcement_id: string
          total_views: number
          unique_views: number
        }[]
      }
      get_audit_policy: {
        Args: never
        Returns: {
          cap_per_minute: number
          dedup_window_seconds: number
          event_type_pattern: string
          min_occurrences_before_escalate: number
        }[]
      }
      get_community_events_health: {
        Args: never
        Returns: {
          event_count: number
          fetched_at: string
          last_refresh_error: string
          last_refresh_status: string
          updated_at: string
        }[]
      }
      get_company_type_context: { Args: { p_id: string }; Returns: Json }
      get_course_completion_counts: {
        Args: { _course_specs: Json }
        Returns: {
          completers: number
          course_key: string
        }[]
      }
      get_dashboard_overview: { Args: { p_user_id: string }; Returns: Json }
      get_deliverable_context: { Args: { p_id: string }; Returns: Json }
      get_email_pipeline_health: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: Json
      }
      get_member_country_distribution: { Args: never; Returns: Json }
      get_milestone_blueprint: { Args: { p_id: string }; Returns: Json }
      get_network_stats: { Args: never; Returns: Json }
      get_node_neighbors: {
        Args: {
          p_id: string
          p_type: Database["public"]["Enums"]["framework_entity_type"]
        }
        Returns: Json
      }
      get_nodes_neighbors_batch: { Args: { p_nodes: Json }; Returns: Json }
      get_own_promotions: {
        Args: { p_user_id: string }
        Returns: {
          confirmed_at: string
          created_at: string
          id: string
          promoted_by: string
          user_id: string
        }[]
      }
      get_project_blast_health: {
        Args: { window_days?: number }
        Returns: Json
      }
      get_project_internal_links: {
        Args: { p_project_id: string }
        Returns: {
          client_intake_url: string
          discord_role_id: string
          discord_role_name: string
          notion_repository_url: string
        }[]
      }
      get_roster_project_header: {
        Args: { p_project_id: string }
        Returns: Json
      }
      get_stakeholder_context: { Args: { p_id: string }; Returns: Json }
      get_top_error_fingerprints: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          affected_users: number
          event_type: string
          fingerprint: string
          first_seen: string
          last_seen: string
          occurrences: number
          sample_message: string
          table_name: string
        }[]
      }
      get_top_silent_failures: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          event_type: string
          last_seen: string
          occurrences: number
          sample_error: string
          table_name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_elevated: { Args: { _user_id: string }; Returns: boolean }
      is_remediation_allowed: { Args: { p_fn: string }; Returns: boolean }
      is_session_revoked: {
        Args: { _issued_at: string; _user_id: string }
        Returns: boolean
      }
      is_trusted_device_active: {
        Args: { _fingerprint: string }
        Returns: boolean
      }
      is_two_factor_login_verified: {
        Args: { _session_hash: string }
        Returns: boolean
      }
      issue_device_binding_nonce: {
        Args: { _purpose: string }
        Returns: string
      }
      kick_community_events_refresh: { Args: never; Returns: undefined }
      list_pending_fanout_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          id: string
          source: string
        }[]
      }
      list_pending_role_grants_for_user: {
        Args: { p_user_id: string }
        Returns: {
          attempts: number
          discord_user_id: string
          id: string
          role_id: string
        }[]
      }
      log_pii_access: {
        Args: { p_access_reason?: string; p_accessed_user_id: string }
        Returns: undefined
      }
      mark_community_agreement_required: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      mark_discord_role_grant_result: {
        Args: { p_error?: string; p_id: string; p_success: boolean }
        Returns: undefined
      }
      mark_two_factor_login_verified: {
        Args: { _session_hash: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      open_incident: {
        Args: {
          _affected_user_count?: number
          _description: string
          _jurisdictions?: string[]
          _severity: Database["public"]["Enums"]["incident_severity"]
          _title: string
        }
        Returns: string
      }
      peek_rate_limit: {
        Args: {
          p_action: string
          p_block_minutes?: number
          p_identifier: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: Json
      }
      process_notification_fanout_chunk: {
        Args: { p_chunk_size?: number; p_job_id: string }
        Returns: Json
      }
      promote_fingerprint_to_known: {
        Args: { p_fix_queue_id: string; p_reason: string }
        Returns: string
      }
      prune_cron_job_run_details: {
        Args: never
        Returns: {
          deleted_rows: number
          freed_after_size: string
        }[]
      }
      prune_email_send_log: { Args: never; Returns: number }
      purge_old_audit_logs: {
        Args: { retention_days?: number }
        Returns: number
      }
      queue_discord_role_grant: {
        Args: {
          p_discord_user_id: string
          p_error?: string
          p_reason?: string
          p_role_id: string
          p_user_id: string
        }
        Returns: string
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_all_stats: { Args: never; Returns: Json }
      reconcile_account_orphans: { Args: never; Returns: Json }
      reconcile_course_badge_parity: { Args: never; Returns: Json }
      record_failed_login: {
        Args: { _email: string; _ip?: string; _user_agent?: string }
        Returns: Json
      }
      record_policy_ack: {
        Args: {
          p_anon_id?: string
          p_electronic_comms: boolean
          p_ip: unknown
          p_method: string
          p_policy_keys: string[]
          p_user_agent: string
          p_version: string
        }
        Returns: undefined
      }
      record_rate_limit_failure: {
        Args: {
          p_action: string
          p_block_minutes?: number
          p_identifier: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: Json
      }
      record_sanctions_screening: {
        Args: {
          p_country: string
          p_decision: string
          p_email: string
          p_ip: unknown
          p_list_version: string
          p_reason: string
        }
        Returns: string
      }
      redact_sensitive_text: { Args: { input: string }; Returns: string }
      refresh_email_health_snapshot: { Args: never; Returns: undefined }
      refresh_framework_overview: { Args: never; Returns: undefined }
      register_for_cohort_click: {
        Args: { p_cohort_id: string; p_referrer?: string }
        Returns: string
      }
      request_class_changes: {
        Args: { p_class_id: string; p_reason: string }
        Returns: undefined
      }
      request_human_review: {
        Args: { _context?: Json; _surface: string }
        Returns: string
      }
      reset_rate_limit: {
        Args: { p_action: string; p_identifier: string }
        Returns: undefined
      }
      retry_pending_discord_role_grants: { Args: never; Returns: number }
      retry_stuck_fanout_jobs: { Args: never; Returns: number }
      run_auto_remediations: { Args: never; Returns: Json }
      safe_create_notification: {
        Args: {
          p_body_html?: string
          p_link_url?: string
          p_notification_type?: string
          p_source?: string
          p_title: string
          p_user_id: string
        }
        Returns: string
      }
      sanitize_user_html: { Args: { input: string }; Returns: string }
      search_framework: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          entity_type: string
          id: string
          name: string
          slug: string
          snippet: string
        }[]
      }
      set_email_visibility_timeout: {
        Args: { message_id: number; queue_name: string; vt: number }
        Returns: boolean
      }
      set_fix_queue_status: {
        Args: { p_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      sign_community_agreement: {
        Args: { p_application_id: string; p_user_agent?: string }
        Returns: {
          application_id: string
          id: string
          ip_address: unknown
          project_id: string
          signed_at: string
          user_agent: string | null
          user_id: string
          version_id: string
        }
        SetofOptions: {
          from: "*"
          to: "community_agreement_signatures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      snooze_fix_queue_entry: {
        Args: { p_days?: number; p_id: string }
        Returns: undefined
      }
      submit_class_for_review: {
        Args: { p_class_id: string; p_cohort_ids?: string[] }
        Returns: undefined
      }
      submit_dispute: {
        Args: {
          p_category: string
          p_email: string
          p_full_name: string
          p_ip: unknown
          p_summary: string
        }
        Returns: string
      }
      submit_dsar: {
        Args: {
          _jurisdiction: string
          _payload: Json
          _type: Database["public"]["Enums"]["dsar_type"]
        }
        Returns: string
      }
      try_write_audit_log: {
        Args: {
          p_changed_fields?: string[]
          p_error_message?: string
          p_event_type: string
          p_record_id: string
          p_table_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_fix_queue_entry: {
        Args: {
          p_error_message: string
          p_event_type: string
          p_fingerprint: string
          p_sample_trace_id?: string
          p_severity?: string
          p_source: string
        }
        Returns: string
      }
      use_invitation: { Args: { p_token: string }; Returns: boolean }
      validate_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          used_at: string
        }[]
      }
      verify_admin_promotion_token: {
        Args: { p_token: string }
        Returns: {
          confirmed_at: string
          id: string
          user_id: string
        }[]
      }
      verify_audit_chain: {
        Args: { p_table?: string }
        Returns: {
          broken_at: string
          broken_id: string
        }[]
      }
      web_vitals_p75: {
        Args: { window_hours?: number }
        Returns: {
          good_pct: number
          metric_name: string
          p75: number
          p95: number
          route: string
          sample_count: number
        }[]
      }
      web_vitals_p75_by_browser: {
        Args: { p_window_hours?: number }
        Returns: {
          browser_name: string
          device_type: string
          good_pct: number
          metric_name: string
          os_name: string
          p75: number
          p95: number
          sample_count: number
        }[]
      }
      web_vitals_p75_by_route_browser: {
        Args: { p_route?: string; p_window_hours?: number }
        Returns: {
          browser_name: string
          device_type: string
          good_pct: number
          metric_name: string
          p75: number
          p95: number
          route: string
          sample_count: number
        }[]
      }
      web_vitals_trend: {
        Args: { window_hours?: number }
        Returns: {
          bucket: string
          metric_name: string
          p75: number
          sample_count: number
        }[]
      }
      write_audit_log:
        | {
            Args: {
              p_changed_fields?: string[]
              p_event_type: string
              p_record_id: string
              p_table_name: string
              p_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_changed_fields?: string[]
              p_error_message?: string
              p_event_type: string
              p_record_id: string
              p_table_name: string
              p_user_id: string
            }
            Returns: undefined
          }
    }
    Enums: {
      app_role: "admin" | "member" | "teacher"
      banner_status: "draft" | "published" | "archived"
      bdd_status: "implemented" | "partial" | "not_built"
      bdd_test_type: "unit" | "e2e" | "both" | "none" | "manual"
      class_status: "draft" | "pending_review" | "published" | "archived"
      class_track: "basic_training" | "advanced_training"
      client_status: "active" | "inactive"
      cohort_status:
        | "draft"
        | "pending_review"
        | "published"
        | "archived"
        | "cancelled"
      dsar_status:
        | "received"
        | "in_review"
        | "need_more_info"
        | "completed"
        | "denied"
        | "appealed"
      dsar_type:
        | "access"
        | "portability"
        | "correction"
        | "erasure"
        | "restrict"
        | "object"
        | "appeal"
        | "human_review"
        | "withdraw_consent"
      framework_entity_type:
        | "activity"
        | "agile_method"
        | "company_type"
        | "deliverable"
        | "duty"
        | "job_function"
        | "job_industry"
        | "job_specialization"
        | "job_title"
        | "practice"
        | "project_milestone"
        | "project"
        | "resource"
        | "skill"
        | "stakeholder"
        | "tech_job_category"
        | "tool"
        | "workshop"
        | "handbook"
      framework_rel_type:
        | "produces"
        | "requires_skill"
        | "requires_activity"
        | "requires_deliverable"
        | "excludes_deliverable"
        | "uses_tool"
        | "uses_practice"
        | "performed_by"
        | "teaches_skill"
        | "part_of"
        | "applies_method"
        | "targets_company_type"
        | "engages_stakeholder"
        | "collaborates_on"
        | "owned_by"
        | "related_to"
        | "precedes"
        | "references_resource"
        | "works_with"
      incident_severity: "low" | "medium" | "high" | "critical"
      journey_phase:
        | "first_steps"
        | "second_steps"
        | "third_steps"
        | "observer"
        | "projects"
        | "project_training"
        | "volunteer"
        | "discord_learning"
      membership_tier: "starter" | "community" | "professional"
      project_phase: "phase_1" | "phase_2" | "phase_3" | "phase_4"
      project_status_enum:
        | "coming_soon"
        | "apply_now"
        | "recruiting"
        | "team_onboarding"
        | "project_in_progress"
        | "project_complete"
      project_type:
        | "website_design"
        | "service_design"
        | "application_design"
        | "strategy"
        | "discovery"
      quest_step_type:
        | "course"
        | "self_report"
        | "system_verified"
        | "application"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member", "teacher"],
      banner_status: ["draft", "published", "archived"],
      bdd_status: ["implemented", "partial", "not_built"],
      bdd_test_type: ["unit", "e2e", "both", "none", "manual"],
      class_status: ["draft", "pending_review", "published", "archived"],
      class_track: ["basic_training", "advanced_training"],
      client_status: ["active", "inactive"],
      cohort_status: [
        "draft",
        "pending_review",
        "published",
        "archived",
        "cancelled",
      ],
      dsar_status: [
        "received",
        "in_review",
        "need_more_info",
        "completed",
        "denied",
        "appealed",
      ],
      dsar_type: [
        "access",
        "portability",
        "correction",
        "erasure",
        "restrict",
        "object",
        "appeal",
        "human_review",
        "withdraw_consent",
      ],
      framework_entity_type: [
        "activity",
        "agile_method",
        "company_type",
        "deliverable",
        "duty",
        "job_function",
        "job_industry",
        "job_specialization",
        "job_title",
        "practice",
        "project_milestone",
        "project",
        "resource",
        "skill",
        "stakeholder",
        "tech_job_category",
        "tool",
        "workshop",
        "handbook",
      ],
      framework_rel_type: [
        "produces",
        "requires_skill",
        "requires_activity",
        "requires_deliverable",
        "excludes_deliverable",
        "uses_tool",
        "uses_practice",
        "performed_by",
        "teaches_skill",
        "part_of",
        "applies_method",
        "targets_company_type",
        "engages_stakeholder",
        "collaborates_on",
        "owned_by",
        "related_to",
        "precedes",
        "references_resource",
        "works_with",
      ],
      incident_severity: ["low", "medium", "high", "critical"],
      journey_phase: [
        "first_steps",
        "second_steps",
        "third_steps",
        "observer",
        "projects",
        "project_training",
        "volunteer",
        "discord_learning",
      ],
      membership_tier: ["starter", "community", "professional"],
      project_phase: ["phase_1", "phase_2", "phase_3", "phase_4"],
      project_status_enum: [
        "coming_soon",
        "apply_now",
        "recruiting",
        "team_onboarding",
        "project_in_progress",
        "project_complete",
      ],
      project_type: [
        "website_design",
        "service_design",
        "application_design",
        "strategy",
        "discovery",
      ],
      quest_step_type: [
        "course",
        "self_report",
        "system_verified",
        "application",
      ],
    },
  },
} as const
