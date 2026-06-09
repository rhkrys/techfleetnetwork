/**
 * useProjectApplicationsRealtime — Realtime Broadcast subscription on the
 * user-scoped topic `user:<uid>:project-applications`. The DB trigger
 * `broadcast_project_application_change` fires a private broadcast on this
 * topic only when the row's `user_id` matches; the realtime.messages RLS
 * policy further restricts subscribers to their own `user:<uid>:*` topic.
 *
 * This replaces postgres_changes CDC on public.project_applications so that
 * no subscriber can ever receive another user's row (the table is no longer
 * in the supabase_realtime publication).
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

    const topic = `user:${user.id}:project-applications`;
    const channel = supabase
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "project_applications_change" }, () => invalidateAll())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
