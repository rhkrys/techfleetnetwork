/**
 * Dashboard overview hook — single round-trip replacement for the eight
 * separate per-widget queries DashboardPage.tsx used to fire on first paint.
 *
 * Audit 2026-04-18: at 10k concurrent users hitting /dashboard during a
 * kickoff event, the old fan-out was ~80k DB queries in the first second.
 * The `get_dashboard_overview` RPC returns everything in one call so peak
 * dashboard load is now ~10k queries instead.
 */
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { identityKey } from "@/lib/query-config";


export interface DashboardGeneralApp {
  id: string;
  status: string;
  completed_at: string | null;
  updated_at: string;
  current_section: number;
}

export interface DashboardProjectApp {
  id: string;
  project_id: string;
  status: string;
  applicant_status: string | null;
  completed_at: string | null;
  updated_at: string;
  current_step: number;
  team_hats_interest: string[];
}

export interface DashboardOverview {
  phase_counts: Record<string, number>;
  general_application: DashboardGeneralApp | null;
  project_applications: DashboardProjectApp[];
}

export function useDashboardOverview() {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery({
    queryKey: identityKey(userId, "dashboard-overview"),

    enabled: !!userId,
    // Dashboard data is not real-time-critical; 5-minute polling cuts admin/user
    // dashboard load by ~80% versus the previous 60s cadence.
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Persist last-known snapshot to localStorage so the dashboard hydrates
    // instantly on reload instead of flashing the brand-new-user UI while the
    // RPC is in flight (DASHBOARD-HYDRATE-001).
    meta: { persist: true },
    queryFn: async (): Promise<DashboardOverview> => {
      // Identity comes from auth.uid() inside the RPC — single source of truth.
      // No client-supplied p_user_id, so the JWT and the DB cannot disagree
      // during a token refresh (which previously raised AppError: Unauthorized).
      const { data, error } = await supabase.rpc("get_dashboard_overview");
      if (error) throw error;
      const raw = (data ?? {}) as Partial<DashboardOverview>;
      return {
        phase_counts: raw.phase_counts ?? {},
        general_application: raw.general_application ?? null,
        project_applications: raw.project_applications ?? [],
      };
    },
  });
}
