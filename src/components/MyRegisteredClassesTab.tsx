import { useQuery } from "@/lib/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { GraduationCap, Calendar, ExternalLink } from "lucide-react";
import { Badge } from "@/design-system";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { CACHE_USER_MUTABLE } from "@/lib/query-config";

type Registration = {
  id: string;
  created_at: string;
  cohort: {
    id: string;
    label: string;
    start_date: string;
    end_date: string;
    status: string;
    class: { id: string; slug: string; title: string; track: string } | null;
  } | null;
};

function statusVariant(status: string): "secondary" | "outline" | "default" {
  if (status === "live" || status === "open") return "default";
  if (status === "completed") return "secondary";
  return "outline";
}

export function MyRegisteredClassesTab() {
  const { user } = useAuth();

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["my-cohort-registrations", user?.id ?? "anon"] as const,
    enabled: !!user,
    queryFn: async (): Promise<Registration[]> => {
      const { data, error } = await supabase
        .from("cohort_registrations")
        .select(
          `
          id, created_at,
          cohort:cohorts!inner (
            id, label, start_date, end_date, status,
            class:classes!inner ( id, slug, title, track )
          )
        `
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Registration[];
    },
    ...CACHE_USER_MUTABLE,
  });

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading your classes…</p>;
  }

  if (registrations.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <GraduationCap
          className="h-12 w-12 mx-auto text-muted-foreground mb-4"
          aria-hidden="true"
        />
        <p className="text-muted-foreground">
          You haven't registered for any classes yet.{" "}
          <Link to="/courses" className="text-primary underline">
            Browse classes
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {registrations.map((r) => {
        const co = r.cohort;
        if (!co || !co.class) return null;
        const cls = co.class;
        return (
          <Link
            key={r.id}
            to={`/classes/${cls.slug}`}
            className="card-elevated p-5 hover:border-primary/40 transition-all group"
            aria-label={`${cls.title} — ${co.label}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <Badge variant={statusVariant(co.status)} className="text-xs capitalize">
                {co.status}
              </Badge>
            </div>
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {cls.title}
            </h3>
            <p className="text-sm text-muted-foreground">{co.label}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              <span>
                {format(new Date(co.start_date), "MMM d, yyyy")} –{" "}
                {format(new Date(co.end_date), "MMM d, yyyy")}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-primary mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
              View class <ExternalLink className="h-3 w-3" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
