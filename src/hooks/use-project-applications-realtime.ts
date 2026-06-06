/**
 * useProjectApplicationsRealtime — Postgres-changes subscription on
 * public.project_applications scoped to the current user. Any INSERT/UPDATE/
 * DELETE invalidates the React Query caches that surface applicant_status so
 * the Applications list, count badge, dashboard widget, quest roadmap, and
 * per-application status page refresh within ~1 second of an admin move.
 *
 * RLS already restricts `project_applications` to `auth.uid() = user_id`, so
 * subscribing here only delivers the caller's own rows.
 */
import { useEffect } from "react";
import { useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useProjectApplicationsRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: ["my-project-applications", user.id] });
      queryClient.invalidateQueries({ queryKey: ["my-project-apps-count", user.id] });
      queryClient.invalidateQueries({ queryKey: ["my-project-app-status"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", user.id] });
      queryClient.invalidateQueries({ queryKey: ["quest-roadmap", user.id] });
      queryClient.invalidateQueries({ queryKey: ["my-active-projects", user.id] });
    };

    const channel = supabase
      .channel(`project-applications-self-${user.id}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "project_applications",
          filter: `user_id=eq.${user.id}`,
        },
        () => invalidateAll(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
