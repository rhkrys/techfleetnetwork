import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef } from "ag-grid-community";
import { format } from "date-fns";
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle,
  Users, Target, Info, HelpCircle, ExternalLink,
} from "lucide-react";
import { PROJECT_TYPES, PROJECT_PHASES } from "@/data/project-constants";

/* ── constants ─────────────────────────────────────── */
const CORE_HATS = ["Project Management", "Product Management", "UX Research", "UX Design"];
const IDEAL_PER_HAT = 4;
const READY_THRESHOLD = 2;

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;

/* ── interfaces ────────────────────────────────────── */
interface ProjectApp {
  id: string;
  user_id: string;
  project_id: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  team_hats_interest: string[];
  participated_previous_phase: boolean;
  passion_for_project: string;
  client_project_knowledge: string;
}

interface ProjectInfo {
  id: string;
  client_id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  clients: { name: string } | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface HatBreakdown {
  unique: number;
  shared: number;
  total: number;
}

interface ScoreDetails {
  hatScore: number;
  hatDetails: { hat: string; uniqueCount: number; subScore: number }[];
  otherScore: number;
  otherHatsCount: number;
  otherHatsFilled: number;
  uniqueScore: number;
  prevScore: number;
  isPhase1: boolean;
}

/* ── scoring logic ─────────────────────────────────── */
function computeReadinessScore(
  hatBreakdowns: Map<string, HatBreakdown>,
  projectHats: string[],
  uniqueRatio: number,
  prevPhaseRatio: number,
  phase: string,
): { score: number; details: ScoreDetails } {
  const corePresent = CORE_HATS.filter((h) => projectHats.includes(h));
  let hatScore = 0;
  const hatDetails: { hat: string; uniqueCount: number; subScore: number }[] = [];
  if (corePresent.length > 0) {
    const perHatScores = corePresent.map((h) => {
      const bd = hatBreakdowns.get(h);
      const uniqueCount = bd?.unique ?? 0;
      let subScore = 0;
      if (uniqueCount >= IDEAL_PER_HAT) subScore = 1;
      else if (uniqueCount >= READY_THRESHOLD) subScore = 0.6;
      else if (uniqueCount >= 1) subScore = 0.3;
      hatDetails.push({ hat: h, uniqueCount, subScore });
      return subScore;
    });
    hatScore = perHatScores.reduce((s, v) => s + v, 0) / corePresent.length;
  }

  const otherHats = projectHats.filter((h) => !CORE_HATS.includes(h));
  let otherScore = 1;
  if (otherHats.length > 0) {
    const filled = otherHats.filter((h) => (hatBreakdowns.get(h)?.unique ?? 0) >= 1).length;
    otherScore = filled / otherHats.length;
  }

  const uniqueScore = uniqueRatio;
  const prevScore = phase === "phase_1" ? 1 : prevPhaseRatio;
  const score = Math.round((hatScore * 0.5 + otherScore * 0.2 + uniqueScore * 0.15 + prevScore * 0.15) * 100);

  return {
    score,
    details: {
      hatScore: Math.round(hatScore * 100),
      hatDetails,
      otherScore: Math.round(otherScore * 100),
      otherHatsCount: otherHats.length,
      otherHatsFilled: otherHats.filter((h) => (hatBreakdowns.get(h)?.unique ?? 0) >= 1).length,
      uniqueScore: Math.round(uniqueRatio * 100),
      prevScore: Math.round((phase === "phase_1" ? 1 : prevPhaseRatio) * 100),
      isPhase1: phase === "phase_1",
    },
  };
}

/* ── Readiness helpers ─────────────────────────────── */
function getOverallReadiness(coreHats: string[], hatBreakdowns: Map<string, HatBreakdown>) {
  if (coreHats.length === 0) return { ready: true, label: "Ready to recruit", color: "text-success", icon: <CheckCircle2 className="h-5 w-5" /> };

  const allReady = coreHats.every((h) => (hatBreakdowns.get(h)?.unique ?? 0) >= READY_THRESHOLD);
  const someReady = coreHats.some((h) => (hatBreakdowns.get(h)?.unique ?? 0) >= 1);

  if (allReady) return { ready: true, label: "Ready to recruit", color: "text-success", icon: <CheckCircle2 className="h-5 w-5" /> };
  if (someReady) return { ready: false, label: "Almost ready", color: "text-warning", icon: <AlertTriangle className="h-5 w-5" /> };
  return { ready: false, label: "Not ready", color: "text-destructive", icon: <XCircle className="h-5 w-5" /> };
}

/* ── main component ────────────────────────────────── */
interface ProjectAnalysisContentProps {
  projectId: string;
}

export default function ProjectAnalysisContent({ projectId }: ProjectAnalysisContentProps) {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const [multiProjectSheet, setMultiProjectSheet] = useState<{ hat: string } | null>(null);

  /* ── data fetching ──────────────────────────────── */
  const { data: project, isLoading: projLoading } = useQuery({
    queryKey: ["analysis-project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, client_id, project_type, phase, project_status, team_hats, clients(name)")
        .eq("id", projectId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ProjectInfo | null;
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  const { data: completedApps } = useQuery({
    queryKey: ["analysis-apps-for-project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "completed");
      if (error) throw error;
      return (data ?? []) as unknown as ProjectApp[];
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  const { data: allApps } = useQuery({
    queryKey: ["analysis-all-completed-apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("user_id, project_id")
        .eq("status", "completed");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && isAdmin,
  });

  // Cross-project name lookup: must include ALL projects (any status),
  // since an applicant's "Also applied to" chip can reference projects
  // that are no longer in apply_now (recruiting, team_onboarding, etc.).
  const { data: crossProjectLookup } = useQuery({
    queryKey: ["analysis-cross-project-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_type, phase, project_status, client_id, clients(name)");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; project_type: string; phase: string; project_status: string; client_id: string; clients: { name: string } | null }[];
    },
    enabled: !!user && isAdmin,
  });

  const userIds = useMemo(() => [...new Set((completedApps ?? []).map((a) => a.user_id))], [completedApps]);

  const { data: profiles } = useQuery({
    queryKey: ["analysis-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, first_name, last_name, email")
        .in("user_id", userIds);
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
    enabled: userIds.length > 0,
  });

  /* ── derived data ───────────────────────────────── */
  const analysis = useMemo(() => {
    if (!completedApps || !allApps || !project) return null;

    const totalApplicants = completedApps.length;
    const userOtherProjects = new Map<string, string[]>();
    for (const app of allApps) {
      if (app.project_id !== projectId) {
        const existing = userOtherProjects.get(app.user_id) ?? [];
        existing.push(app.project_id);
        userOtherProjects.set(app.user_id, existing);
      }
    }
    const uniqueUserIds = new Set(completedApps.filter((a) => !userOtherProjects.has(a.user_id)).map((a) => a.user_id));
    const uniqueApplicants = uniqueUserIds.size;
    const sharedApplicants = totalApplicants - uniqueApplicants;
    const uniqueRatio = totalApplicants > 0 ? uniqueApplicants / totalApplicants : 0;

    const hatBreakdowns = new Map<string, HatBreakdown>();
    for (const app of completedApps) {
      const isUnique = uniqueUserIds.has(app.user_id);
      for (const hat of app.team_hats_interest) {
        const prev = hatBreakdowns.get(hat) ?? { unique: 0, shared: 0, total: 0 };
        prev.total += 1;
        if (isUnique) prev.unique += 1;
        else prev.shared += 1;
        hatBreakdowns.set(hat, prev);
      }
    }

    const prevPhaseApplicants = completedApps.filter((a) => a.participated_previous_phase).length;
    const prevPhaseRatio = totalApplicants > 0 ? prevPhaseApplicants / totalApplicants : 0;
    const { score: readinessScore, details: scoreDetails } = computeReadinessScore(
      hatBreakdowns, project.team_hats, uniqueRatio, prevPhaseRatio, project.phase,
    );

    const userCrossProjectDetail = new Map<string, { projectId: string; clientName: string }[]>();
    for (const app of allApps) {
      if (app.project_id !== projectId && userIds.includes(app.user_id)) {
        const existing = userCrossProjectDetail.get(app.user_id) ?? [];
        const proj = crossProjectLookup?.find((p) => p.id === app.project_id);
        existing.push({ projectId: app.project_id, clientName: proj?.clients?.name ?? "Unknown project" });
        userCrossProjectDetail.set(app.user_id, existing);
      }
    }

    return {
      totalApplicants, hatBreakdowns, uniqueApplicants, sharedApplicants, uniqueRatio,
      uniqueUserIds, prevPhaseApplicants, prevPhaseRatio, readinessScore, scoreDetails,
      userCrossProjectDetail,
    };
  }, [completedApps, allApps, project, projectId, userIds, crossProjectLookup]);

  /* ── AG Grid ────────────────────────────────────── */
  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileRow>();
    for (const p of profiles ?? []) m.set(p.user_id, p);
    return m;
  }, [profiles]);

  const enrichedRows = useMemo(() => {
    if (!completedApps) return [];
    return completedApps.map((app) => ({
      ...app,
      profile: profileMap.get(app.user_id),
      otherProjects: analysis?.userCrossProjectDetail.get(app.user_id) ?? [],
      isUnique: analysis?.uniqueUserIds.has(app.user_id) ?? false,
    }));
  }, [completedApps, profileMap, analysis]);

  /* ── loading ────────────────────────────────────── */
  if (projLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <p>Project not found or no data available.</p>
      </div>
    );
  }

  const clientName = project.clients?.name ?? "this project";
  const isPhase1 = project.phase === "phase_1";
  const coreHats = project.team_hats.filter((h) => CORE_HATS.includes(h));
  const otherHats = project.team_hats.filter((h) => !CORE_HATS.includes(h));

  const overallReadiness = analysis
    ? getOverallReadiness(coreHats, analysis.hatBreakdowns)
    : { ready: false, label: "Not ready", color: "text-destructive", icon: <XCircle className="h-5 w-5" /> };

  function HatRow({ hat }: { hat: string }) {
    const bd = analysis?.hatBreakdowns.get(hat) ?? { unique: 0, shared: 0, total: 0 };
    const fillPercent = Math.min(Math.round((bd.unique / READY_THRESHOLD) * 100), 100);

    let statusLabel: string;
    let statusIcon: ReactNode;
    let statusColor: string;
    let barColor: string;

    if (bd.unique >= READY_THRESHOLD) {
      statusLabel = "Ready to recruit";
      statusIcon = <CheckCircle2 className="h-4 w-4" />;
      statusColor = "text-success";
      barColor = "bg-success";
    } else if (bd.unique >= 1) {
      statusLabel = "Almost ready";
      statusIcon = <AlertTriangle className="h-4 w-4" />;
      statusColor = "text-warning";
      barColor = "bg-warning";
    } else {
      statusLabel = "Not ready";
      statusIcon = <XCircle className="h-4 w-4" />;
      statusColor = "text-destructive";
      barColor = "bg-destructive";
    }

    return (
      <div className="w-full sm:w-1/2 rounded-lg border bg-card p-5 space-y-3">
        {/* Primary: Hat name — largest text */}
        <h4 className="text-base font-bold text-foreground leading-tight">{hat}</h4>

        {/* Secondary: Status badge directly under name */}
        <div className={`flex items-center gap-1.5 ${statusColor}`}>
          {statusIcon}
          <span className="text-sm font-semibold">{statusLabel}</span>
        </div>

        <Separator />

        {/* Tertiary: Application breakdown */}
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">{bd.total}</span> {bd.total === 1 ? "person" : "people"} interested in this duty
          </p>
          <Separator className="!my-1" />
          <p>
            <span className="font-semibold text-success">{bd.unique}</span>{" "}
            applied to only <span className="font-medium text-foreground">{clientName}</span>
          </p>
          <button
            type="button"
            className="text-muted-foreground hover:underline underline-offset-2 focus-visible:outline-2 outline-ring rounded-sm disabled:opacity-50 disabled:cursor-default text-left"
            disabled={bd.shared === 0}
            onClick={() => bd.shared > 0 && setMultiProjectSheet({ hat })}
          >
            <span className="font-semibold text-warning">{bd.shared}</span>{" "}
            applied to other projects too
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{bd.unique} of {READY_THRESHOLD} needed to be ready</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${fillPercent}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  const details = analysis?.scoreDetails;

  return (
    <div className="space-y-8">
      {/* ── Readiness Status ─────────────────────── */}
      <div className="space-y-4">
        {/* Big readiness indicator */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={overallReadiness.color}>
                {overallReadiness.icon}
              </div>
              <div>
                <p className={`text-xl font-bold ${overallReadiness.color}`}>
                  {overallReadiness.label}
                </p>
                <p className="text-sm text-muted-foreground">
                  {overallReadiness.ready
                    ? `Every core role has at least ${READY_THRESHOLD} applicants who only applied to ${clientName}. You're good to go.`
                    : `Some core roles still need at least ${READY_THRESHOLD} applicants who only applied to ${clientName}.`}
                </p>
              </div>
              <div className="ml-auto">
                <ScoreBreakdownDialog score={analysis?.readinessScore ?? 0} details={details} clientName={clientName} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats cards — stacked on mobile */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Applicant Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Applicants</span>
                <span className="text-sm font-semibold">{analysis?.totalApplicants ?? 0}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Applied only to {clientName}</span>
                <span className="text-sm font-semibold text-success">{analysis?.uniqueApplicants ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Applied to other projects too</span>
                <span className="text-sm font-semibold text-warning">{analysis?.sharedApplicants ?? 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Previous Phase Participation</CardTitle>
            </CardHeader>
            <CardContent>
              {isPhase1 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Info className="h-4 w-4 shrink-0" />
                  <span className="text-sm">Not applicable — this is a Phase 1 project with no prior phase.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Participated in previous phase</span>
                    <span className="text-sm font-semibold">{analysis?.prevPhaseApplicants ?? 0} of {analysis?.totalApplicants ?? 0}</span>
                  </div>
                  <Progress value={(analysis?.prevPhaseRatio ?? 0) * 100} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    Applicants with prior phase experience bring continuity and reduce ramp-up time.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Core Role Staffing ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Core Role Staffing
          </CardTitle>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Each core role needs at least <strong>{READY_THRESHOLD} applicants</strong> who only applied to {clientName} to be considered ready.
            </p>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
              <strong>{analysis?.totalApplicants ?? 0} unique {(analysis?.totalApplicants ?? 0) === 1 ? "person" : "people"}</strong> applied to this project.
              Since applicants can select multiple duties, the same person may appear in more than one card below.
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> <strong>Ready to recruit</strong> = {READY_THRESHOLD}+ applicants</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-warning" /> <strong>Almost ready</strong> = 1 applicant</span>
              <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-destructive" /> <strong>Not ready</strong> = 0 applicants</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {coreHats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No core roles configured for this project.</p>
          ) : (
            coreHats.map((hat) => <HatRow key={hat} hat={hat} />)
          )}
        </CardContent>
      </Card>

      {otherHats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Additional Roles
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Supporting roles that strengthen the team. Not weighted as heavily in the readiness score, but still important for well-rounded recruiting.
            </p>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Applicants can select multiple duties — the same person may appear in more than one card.
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {otherHats.map((hat) => <HatRow key={hat} hat={hat} />)}
          </CardContent>
        </Card>
      )}

      {/* Applicants table removed per design — use Project Roster tab instead */}

      {/* ── Multi-project applicants side panel ── */}
      <Sheet open={!!multiProjectSheet} onOpenChange={(open) => !open && setMultiProjectSheet(null)}>
        <SheetContent resizeKey="project-analysis-multi" className="w-full sm:max-w-lg" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle className="break-words">
              Applicants who also applied elsewhere — {multiProjectSheet?.hat}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100dvh-6rem)] mt-4 pr-3">
            <div className="space-y-4">
              {(() => {
                if (!multiProjectSheet || !completedApps || !analysis) return null;
                const hat = multiProjectSheet.hat;
                const sharedForHat = completedApps.filter(
                  (app) =>
                    app.team_hats_interest.includes(hat) &&
                    !analysis.uniqueUserIds.has(app.user_id),
                );
                if (sharedForHat.length === 0) {
                  return <p className="text-sm text-muted-foreground">No applicants applied to other projects for this role.</p>;
                }
                return sharedForHat.map((app) => {
                  const profile = profileMap.get(app.user_id);
                  const name =
                    profile?.display_name ||
                    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() ||
                    profile?.email ||
                    "Unknown";
                  const otherProjects = analysis.userCrossProjectDetail.get(app.user_id) ?? [];
                  return (
                    <div key={app.id} className="rounded-md border bg-card p-4 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{name}</p>
                        {profile?.email && (
                          <p className="text-xs text-muted-foreground">{profile.email}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Roles applied for on {clientName}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {app.team_hats_interest.map((h) => (
                            <Badge key={h} variant={h === hat ? "default" : "outline"} className="text-xs">
                              {h}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Separator />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Also applied to</p>
                        {otherProjects.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No other projects found</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {otherProjects.map((op) => {
                              const isResolved = op.clientName !== "Unknown project";
                              if (isResolved) {
                                return (
                                  <Link key={op.projectId} to={`/admin/roster/project/${op.projectId}`}>
                                    <Badge variant="secondary" className="text-xs gap-1 hover:bg-secondary/80 cursor-pointer">
                                      <ExternalLink className="h-3 w-3" />
                                      {op.clientName}
                                    </Badge>
                                  </Link>
                                );
                              }
                              return (
                                <Badge key={op.projectId} variant="secondary" className="text-xs">
                                  {op.clientName}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── Applicants Table with AG Grid ─────────────────── */
interface EnrichedRow {
  id: string;
  user_id: string;
  team_hats_interest: string[];
  participated_previous_phase: boolean;
  completed_at: string | null;
  created_at: string;
  profile?: ProfileRow;
  otherProjects: { projectId: string; clientName: string }[];
  isUnique: boolean;
}

function ApplicantsTable({ rows, clientName }: { rows: EnrichedRow[]; clientName: string }) {
  const getName = useCallback((p?: ProfileRow) =>
    p?.display_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || p?.email || "Unknown", []);

  const columnDefs = useMemo<ColDef<EnrichedRow>[]>(() => [
    { headerName: "Applicant", flex: 2, minWidth: 140, valueGetter: (params) => getName(params.data?.profile) },
    { headerName: "Email", flex: 2, minWidth: 160, valueGetter: (params) => params.data?.profile?.email ?? "—" },
    { headerName: `Only ${clientName}`, flex: 1, minWidth: 90, valueGetter: (params) => params.data?.isUnique ? "Yes" : "No" },
    { headerName: "Roles", flex: 2, minWidth: 160, valueGetter: (params) => (params.data?.team_hats_interest ?? []).join(", ") },
    { headerName: "Prev. Phase", flex: 1, minWidth: 100, valueGetter: (params) => params.data?.participated_previous_phase ? "Yes" : "No" },
    {
      headerName: "Other Projects", flex: 2, minWidth: 140,
      valueGetter: (params) => {
        const ops = params.data?.otherProjects ?? [];
        return ops.length === 0 ? "None" : ops.map((op) => op.clientName).join(", ");
      },
    },
    {
      headerName: "Submitted", flex: 1, minWidth: 110,
      valueGetter: (params) => params.data?.completed_at ?? params.data?.created_at,
      valueFormatter: (params) => {
        if (!params.value) return "—";
        try { return format(new Date(params.value), "MMM d, yyyy"); } catch { return "—"; }
      },
    },
  ], [getName, clientName]);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>All Applicants</CardTitle>
        <p className="text-sm text-muted-foreground">
          {rows.length} completed {rows.length === 1 ? "application" : "applications"} for this project
        </p>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div style={{ width: "100%", minWidth: 0 }}>
          <ThemedAgGrid<EnrichedRow>
            gridId="analysis-applicants"
            height="560px"
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            pagination
            paginationPageSize={10}
            showExportCsv
            exportFileName="analysis-applicants"
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Score Breakdown Dialog ───────────────────────── */
function ScoreBreakdownDialog({ score, details, clientName }: { score: number; details?: ScoreDetails; clientName: string }) {
  if (!details) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <HelpCircle className="h-3.5 w-3.5" />
          Score details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Recruitment Readiness — Score Breakdown</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          <section className="space-y-2">
            <div className="flex justify-between font-medium">
              <span>Core Role Staffing <span className="text-muted-foreground font-normal">(50% of score)</span></span>
              <span className="text-primary">{details.hatScore}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Do we have enough applicants who only applied to {clientName} for each core role? {READY_THRESHOLD}+ = ready, 1 = almost, 0 = not ready.
            </p>
            <div className="space-y-1.5 pl-3 border-l-2 border-muted">
              {details.hatDetails.map((h) => (
                <div key={h.hat} className="flex justify-between text-xs">
                  <span>{h.hat} — <strong>{h.uniqueCount}</strong> applied only to {clientName}</span>
                  <span className={h.subScore >= 0.6 ? "text-success font-medium" : h.subScore >= 0.3 ? "text-warning font-medium" : "text-muted-foreground"}>{Math.round(h.subScore * 100)}%</span>
                </div>
              ))}
            </div>
          </section>
          <Separator />
          <section className="space-y-1">
            <div className="flex justify-between font-medium">
              <span>Additional Roles <span className="text-muted-foreground font-normal">(20% of score)</span></span>
              <span className="text-primary">{details.otherScore}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {details.otherHatsCount === 0
                ? "No additional roles on this project — full marks automatically."
                : `${details.otherHatsFilled} of ${details.otherHatsCount} additional roles have at least 1 applicant who only applied to ${clientName}.`}
            </p>
          </section>
          <Separator />
          <section className="space-y-1">
            <div className="flex justify-between font-medium">
              <span>Applicant Dedication <span className="text-muted-foreground font-normal">(15% of score)</span></span>
              <span className="text-primary">{details.uniqueScore}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              What percentage of applicants <em>only</em> applied to {clientName}? Higher = more committed pool.
            </p>
          </section>
          <Separator />
          <section className="space-y-1">
            <div className="flex justify-between font-medium">
              <span>Returning Members <span className="text-muted-foreground font-normal">(15% of score)</span></span>
              <span className="text-primary">{details.prevScore}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {details.isPhase1
                ? "Phase 1 project — no prior phase exists, so this is automatically 100%."
                : "What percentage of applicants participated in the previous phase? Returning members reduce ramp-up time."}
            </p>
          </section>
          <Separator />
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex justify-between font-semibold text-base">
              <span>Overall Score</span>
              <span className="text-primary">{score}%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ({details.hatScore}% × 0.5) + ({details.otherScore}% × 0.2) + ({details.uniqueScore}% × 0.15) + ({details.prevScore}% × 0.15)
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
