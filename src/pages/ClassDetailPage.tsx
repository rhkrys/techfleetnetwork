import { Link, useParams } from "react-router-dom";
import {
  Loader2,
  Plus,
  ArrowLeft,
  Pencil,
  ExternalLink,
  History,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { format } from "date-fns";
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@/design-system";

import { useClassById } from "@/hooks/use-classes";
import { useCohortsByClass } from "@/hooks/use-cohorts";
import { CohortService } from "@/services/cohort.service";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { useQueryClient, useQuery } from "@/lib/react-query";
import { ApprovalActions } from "@/components/classes/ApprovalActions";
import { ClassAuditHistory } from "@/components/classes/ClassAuditHistory";
import { ClassService } from "@/services/class.service";
import { sanitizeHtml } from "@/lib/security";

import { CurriculumEditor, LearnerCurriculumView } from "@/features/class-curriculum";
import { supabase } from "@/integrations/supabase/client";

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-warning/10 text-warning border-warning/20",
  published: "bg-success/10 text-success border-success/20",
  archived: "bg-muted text-muted-foreground",
};

export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const queryClient = useQueryClient();
  const { data: cls, isLoading } = useClassById(id);
  const { data: cohorts = [] } = useCohortsByClass(id);
  const [showHistory, setShowHistory] = useState(false);

  // Latest "request_changes" reason for owners.
  const { data: history = [] } = useQuery({
    queryKey: ["classes", "audit", id ?? "none"] as const,
    queryFn: () => (id ? ClassService.listAuditHistory(id) : Promise.resolve([])),
    enabled: !!id,
  });
  // Enrollment check for curriculum tab visibility (learners). Hoisted above the
  // loading early-return below so hook order stays stable (react-hooks/rules-of-hooks).
  const { data: isEnrolled = false } = useQuery({
    queryKey: ["class-enrollment", id ?? "none", user?.id ?? "anon"] as const,
    queryFn: async () => {
      if (!id || !user?.id) return false;
      const { data: rows } = await supabase
        .from("cohort_registrations")
        .select("cohorts!inner(class_id)")
        .eq("user_id", user.id)
        .eq("cohorts.class_id", id)
        .limit(1);
      return (rows?.length ?? 0) > 0;
    },
    enabled: !!id && !!user?.id,
    staleTime: 60_000,
  });
  const latestChangesReason = (() => {
    if (cls?.status !== "draft") return null;
    const r = history.find((h) => h.action === "request_changes");
    return r?.reason ?? null;
  })();

  if (isLoading || !cls) {
    return (
      <div className="container-app py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const isOwner = user?.id === cls.owner_user_id;
  const canEdit = isOwner || isAdmin;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["classes"] });

  const canSeeCurriculum = canEdit || isEnrolled;

  const submitCohort = async (cohortId: string) => {
    try {
      await CohortService.submitForReview(cls.id, [cohortId]);
      toast.success("Cohort submitted for review");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <div className="container-app py-8 sm:py-12 space-y-6 max-w-4xl">
      <Button asChild variant="ghost" size="sm">
        <Link to={isAdmin ? "/admin/classes" : "/teach/classes"}>
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          Back
        </Link>
      </Button>

      {canEdit && (
        <div
          className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex flex-wrap justify-end gap-2"
          data-no-card
        >
          <Button asChild variant="outline" size="sm">
            <Link to={`/teach/classes/${cls.id}/edit`}>
              <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
              Edit
            </Link>
          </Button>
          <ApprovalActions cls={cls} isOwner={isOwner} isAdmin={isAdmin} />
        </div>
      )}

      {cls.hero_image_url && (
        <img
          src={cls.hero_image_url}
          alt={`${cls.title} hero`}
          className="w-full max-h-72 object-cover rounded-md border border-border"
          loading="lazy"
        />
      )}

      {isOwner && latestChangesReason && (
        <div
          role="alert"
          className="rounded-md border border-warning/30 bg-warning/10 p-4 flex gap-3"
        >
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">Changes were requested</div>
            <div className="text-sm text-foreground whitespace-pre-wrap">{latestChangesReason}</div>
            <div className="text-xs text-muted-foreground">
              Edit your class and resubmit when ready.
            </div>
          </div>
        </div>
      )}

      <div>
        <Badge variant="outline" className={`mb-2 ${STATUS_CLASS[cls.status] ?? ""}`}>
          {cls.status.replace("_", " ")}
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{cls.title}</h1>
        {cls.summary && (
          <div
            className="prose prose-invert max-w-none text-sm text-muted-foreground mt-1"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(cls.summary) }}
          />
        )}
      </div>

      {cls.description && (
        <section>
          <h2 className="font-semibold text-base mb-2">About this class</h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(cls.description) }}
          />
        </section>
      )}

      {cls.why_take && (
        <section>
          <h2 className="font-semibold text-base mb-2">Why take this course?</h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(cls.why_take) }}
          />
        </section>
      )}

      {cls.outcomes && (
        <section>
          <h2 className="font-semibold text-base mb-2">Outcomes</h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(cls.outcomes) }}
          />
        </section>
      )}

      {cls.audiences && (
        <section>
          <h2 className="font-semibold text-base mb-2">Audiences</h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(cls.audiences) }}
          />
        </section>
      )}

      {(cls as { curriculum?: string }).curriculum?.trim() && (
        <section aria-labelledby="class-curriculum-heading">
          <h2 id="class-curriculum-heading" className="font-semibold text-base mb-2">
            Curriculum
          </h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml((cls as { curriculum?: string }).curriculum ?? ""),
            }}
          />
        </section>
      )}

      {(cls as { reading_assignments?: string }).reading_assignments?.trim() && (
        <section aria-labelledby="class-reading-heading">
          <h2 id="class-reading-heading" className="font-semibold text-base mb-2">
            Reading Assignments
          </h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(
                (cls as { reading_assignments?: string }).reading_assignments ?? ""
              ),
            }}
          />
        </section>
      )}

      {(cls as { class_expectations?: string }).class_expectations?.trim() && (
        <section aria-labelledby="class-expectations-heading">
          <h2 id="class-expectations-heading" className="font-semibold text-base mb-2">
            Class Expectations
          </h2>
          <div
            className="prose prose-invert max-w-none text-sm text-foreground"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(
                (cls as { class_expectations?: string }).class_expectations ?? ""
              ),
            }}
          />
        </section>
      )}

      {cls.skills.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {cls.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue={canSeeCurriculum ? "curriculum" : "cohorts"} className="space-y-4">
        <TabsList>
          {canSeeCurriculum && <TabsTrigger value="curriculum">Curriculum</TabsTrigger>}
          <TabsTrigger value="cohorts">Cohorts</TabsTrigger>
        </TabsList>

        {canSeeCurriculum && (
          <TabsContent value="curriculum" className="space-y-4">
            {canEdit ? (
              <CurriculumEditor classId={cls.id} />
            ) : (
              <LearnerCurriculumView classId={cls.id} />
            )}
          </TabsContent>
        )}

        <TabsContent value="cohorts">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold">Cohorts</h2>
              {canEdit && (
                <Button asChild size="sm">
                  <Link to={`/teach/classes/${cls.id}/cohorts/new`}>
                    <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                    New cohort
                  </Link>
                </Button>
              )}
            </div>
            {cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cohorts yet.</p>
            ) : (
              <div className="space-y-2">
                {cohorts.map((c) => (
                  <div key={c.id} className="card-elevated p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-foreground">{c.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(c.start_date), "MMM d")} –{" "}
                          {format(new Date(c.end_date), "MMM d, yyyy")} · {c.timezone}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{c.status}</Badge>
                        {c.status === "published" && c.registration_url && (
                          <Button
                            asChild
                            size="sm"
                            onClick={() =>
                              CohortService.recordRegistrationClick(c.id).catch(() => undefined)
                            }
                          >
                            <a href={c.registration_url} target="_blank" rel="noopener noreferrer">
                              Register <ExternalLink className="h-3 w-3 ml-1" aria-hidden="true" />
                            </a>
                          </Button>
                        )}
                        {canEdit &&
                          (isAdmin || c.status === "draft" || c.status === "pending_review") && (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to={`/teach/classes/${cls.id}/cohorts/${c.id}/edit`}
                                aria-label={`Edit cohort ${c.label}`}
                              >
                                <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                                Edit
                              </Link>
                            </Button>
                          )}
                        {canEdit && c.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => submitCohort(c.id)}>
                            Submit
                          </Button>
                        )}
                      </div>
                    </div>
                    {(c as { schedule?: string }).schedule?.trim() && (
                      <div className="border-t border-border pt-2">
                        <div className="text-xs font-semibold text-muted-foreground mb-1">
                          Schedule of Classes
                        </div>
                        <div
                          className="prose prose-invert max-w-none text-sm text-foreground"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHtml((c as { schedule?: string }).schedule ?? ""),
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <section>
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary"
          onClick={() => setShowHistory((s) => !s)}
          aria-expanded={showHistory}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Approval history
        </button>
        {showHistory && (
          <div className="mt-3">
            <ClassAuditHistory classId={cls.id} />
          </div>
        )}
      </section>
    </div>
  );
}
