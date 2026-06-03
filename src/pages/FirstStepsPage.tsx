import { useState, useEffect, useRef, startTransition } from "react";
import { CheckCircle2, Circle, Play, User, ExternalLink, Figma, ScrollText, ShieldCheck, FileText, Cookie, Gavel, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@/lib/react-query";
import { JourneyService } from "@/services/journey.service";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import { toast } from "sonner";
import { CommunityAgreementPanel } from "@/components/CommunityAgreementPanel";
import { LegalPolicyPanel } from "@/components/LegalPolicyPanel";
import { DiscordInviteBanner } from "@/components/DiscordInviteBanner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  icon: React.ElementType;
  action: string;
  external?: boolean;
  panelAction?: boolean;
  panelId?: string;
}

/** Canonical list of first-steps task IDs — used by progress calculations. */
export const FIRST_STEPS_TASK_IDS = [
  "community-agreement",
  "terms-conditions",
  "terms-of-use",
  "privacy-policy",
  "cookie-policy",
  "profile",
  "onboarding-class",
  "figma-account",
] as const;

export const TOTAL_FIRST_STEPS = FIRST_STEPS_TASK_IDS.length; // 8

const baseTasks: Omit<Task, "completed">[] = [
  {
    id: "community-agreement",
    title: "Agree to the Community Member Agreement",
    description: "Read and accept the Tech Fleet Community Collective Agreement.",
    icon: ScrollText,
    action: "#",
    panelAction: true,
    panelId: "community-agreement",
  },
  {
    id: "terms-conditions",
    title: "Agree to the Tech Fleet Terms & Conditions",
    description: "Master agreement that governs your Tech Fleet membership.",
    icon: Gavel,
    action: "#",
    panelAction: true,
    panelId: "terms-conditions",
  },
  {
    id: "terms-of-use",
    title: "Agree to the Tech Fleet Terms of Use",
    description: "Acceptable-use rules for the Tech Fleet Network platform.",
    icon: FileText,
    action: "#",
    panelAction: true,
    panelId: "terms-of-use",
  },
  {
    id: "privacy-policy",
    title: "Agree to the Tech Fleet Privacy Policy",
    description: "How Tech Fleet collects, uses, and protects your data.",
    icon: ShieldCheck,
    action: "#",
    panelAction: true,
    panelId: "privacy-policy",
  },
  {
    id: "cookie-policy",
    title: "Acknowledge the Tech Fleet Cookie Policy",
    description: "Categories of cookies we set and how to manage your choices.",
    icon: Cookie,
    action: "#",
    panelAction: true,
    panelId: "cookie-policy",
  },
  {
    id: "profile",
    title: "Set Up Profile",
    description: "Fill in your name, country, and activity interests.",
    icon: User,
    action: "/profile-setup",
  },
  {
    id: "onboarding-class",
    title: "Attend a Community Onboarding Meeting",
    description: "Register for and attend the Tech Fleet onboarding session.",
    icon: Play,
    action: "https://techfleet.org/onboarding",
    external: true,
  },
  {
    id: "figma-account",
    title: "Register for Figma Educational Account",
    description: "Join the Tech Fleet Figma educational workspace.",
    icon: Figma,
    action: "https://guide.techfleet.org/resources/join-the-tech-fleet-figma-educational-space",
    external: true,
  },
];

const LEGAL_PANELS: Record<string, { title: string; description: string; policyKey: string; downloadUrl: string; acceptLabel: string }> = {
  "terms-conditions": {
    title: "Tech Fleet Terms & Conditions",
    description: "Master agreement governing your membership and use of Tech Fleet services.",
    policyKey: "terms-and-conditions",
    downloadUrl: "/terms",
    acceptLabel: "Tech Fleet Terms & Conditions",
  },
  "terms-of-use": {
    title: "Tech Fleet Terms of Use",
    description: "Acceptable-use rules for the Tech Fleet Network platform.",
    policyKey: "terms-of-use",
    downloadUrl: "/terms-of-use",
    acceptLabel: "Tech Fleet Terms of Use",
  },
  "privacy-policy": {
    title: "Tech Fleet Privacy Policy",
    description: "How we collect, use, share, and protect your personal information.",
    policyKey: "privacy",
    downloadUrl: "/privacy",
    acceptLabel: "Tech Fleet Privacy Policy",
  },
  "cookie-policy": {
    title: "Tech Fleet Cookie Policy",
    description: "Cookies and similar technologies used on Tech Fleet sites.",
    policyKey: "cookies",
    downloadUrl: "/cookies",
    acceptLabel: "Tech Fleet Cookie Policy",
  },
};

export default function FirstStepsPage() {
  const { user, profile, profileLoaded } = useAuth();
  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const taskDefs = baseTasks;

  const [tasks, setTasks] = useState<Task[]>(taskDefs.map((t) => ({ ...t, completed: false })));
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [legalPanelId, setLegalPanelId] = useState<keyof typeof LEGAL_PANELS | null>(null);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [pendingUncomplete, setPendingUncomplete] = useState<string | null>(null);
  const completionShownRef = useRef(false);

  // Re-build tasks when profile changes (e.g. discord added) or profile finishes loading
  useEffect(() => {
    if (!profileLoaded) return;
    setTasks((prev) => {
      const prevMap = new Map(prev.map((t) => [t.id, t.completed]));
      return taskDefs.map((t) => ({ ...t, completed: prevMap.get(t.id) || false }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.discord_username, profileLoaded]);

  useEffect(() => {
    if (!user) return;
    JourneyService.getProgress(user.id, "first_steps").then((progress) => {
      const completedMap = new Map(progress.map((d) => [d.task_id, d.completed]));
      setTasks((prev) => prev.map((t) => ({ ...t, completed: completedMap.get(t.id) || false })));
    });
  }, [user]);

  const getDisplayName = () =>
    profile?.display_name || profile?.first_name || user?.user_metadata?.full_name || "A member";
  const getDiscordUsername = () => profile?.discord_username || undefined;
  const getDiscordUserId = () => profile?.discord_user_id || undefined;

  const handleExternalVisit = (id: string, url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");

    // Notify Discord for class registration actions
    const name = getDisplayName();
    const discord = getDiscordUsername();
    const discordId = getDiscordUserId();
    if (id === "onboarding-class") {
      DiscordNotifyService.classRegistered(name, "Onboarding Class", discord, discordId);
    } else if (id === "service-leadership") {
      DiscordNotifyService.classRegistered(name, "Service Leadership Class", discord, discordId);
    }
  };

  const toggleTask = async (id: string) => {
    if (!user) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    // §2B1: re-clicking a completed task must require a verb+object confirm.
    // The DB BEFORE-UPDATE guard on journey_progress also blocks silent
    // uncompletes — this UI gate prevents accidental clicks before the round-trip.
    if (task.completed) {
      setPendingUncomplete(id);
      return;
    }

    const newCompleted = !task.completed;


    // CWV pass 4 (INP): paint the optimistic state IMMEDIATELY so the click
    // commits within the 200ms INP budget. The network round-trip and the
    // Discord notify happen after the paint; a failure rolls the row back.
    startTransition(() => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: newCompleted } : t)));
    });
    setLoadingId(id);

    try {
      await JourneyService.upsertTask(user.id, "first_steps", id, newCompleted);
      queryClient.invalidateQueries({ queryKey: ["journey-completed", user.id, "first_steps"] });
      queryClient.invalidateQueries({ queryKey: ["journey-progress", user.id, "first_steps"] });

      if (newCompleted) {
        const name = getDisplayName();
        const discord = getDiscordUsername();
        const discordId = getDiscordUserId();

        // Check if all tasks are now complete — send phase notification instead of task
        const newCompletedCount = tasks.filter((t) => t.id !== id ? t.completed : true).length;
        if (newCompletedCount === tasks.length) {
          // Fire-and-forget — must not block the click commit.
          void DiscordNotifyService.phaseCompleted(name, "first_steps", discord, discordId);
          if (!completionShownRef.current) {
            completionShownRef.current = true;
            setShowCompletionDialog(true);
          }
        } else {
          void DiscordNotifyService.taskCompleted(name, id, discord, discordId);
        }
      }
    } catch (err: any) {
      // Roll back optimistic update on failure.
      startTransition(() => {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: task.completed } : t)));
      });
      console.error("[FirstSteps] toggleTask failed:", err);
      toast.error("We couldn't update that task. Please try again.", {
        description: err?.message || "Please try again.",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handlePanelAccepted = async (taskId: string) => {
    if (!user) return;
    setLoadingId(taskId);
    try {
      await JourneyService.upsertTask(user.id, "first_steps", taskId, true);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, completed: true } : t))
      );
      queryClient.invalidateQueries({ queryKey: ["journey-completed", user.id, "first_steps"] });
      queryClient.invalidateQueries({ queryKey: ["journey-progress", user.id, "first_steps"] });

      const name = getDisplayName();
      const discord = getDiscordUsername();
      const discordId = getDiscordUserId();

      // Send phase notification instead of task if all tasks are now complete
      const newCompletedCount = tasks.filter((t) => t.id !== taskId ? t.completed : true).length;
      if (newCompletedCount === tasks.length) {
        DiscordNotifyService.phaseCompleted(name, "first_steps", discord, discordId);
        if (!completionShownRef.current) {
          completionShownRef.current = true;
          setShowCompletionDialog(true);
        }
      } else {
        DiscordNotifyService.taskCompleted(name, taskId, discord, discordId);
      }
    } catch (err: any) {
      console.error("[FirstSteps] handlePanelAccepted failed:", err);
      toast.error("We couldn't update that task. Please try again.", {
        description: err?.message || "Please try again.",
      });
    } finally {
      setLoadingId(null);
      setAgreementOpen(false);
      setLegalPanelId(null);
    }
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const allComplete = completedCount === tasks.length;
  const progress = (completedCount / tasks.length) * 100;

  return (
    <div className="container-app py-8 sm:py-12 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Courses</h1>
        <Breadcrumb className="mt-2">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/courses">Courses</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Onboarding Steps</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <p className="text-muted-foreground mt-2">Complete all {tasks.length} tasks below to unlock the next phase. You can do them in any order.</p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">{completedCount} of {tasks.length} tasks completed</span>
          <span className="font-medium text-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding Steps progress">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <DiscordInviteBanner />

      <div className="space-y-3">
        {tasks.map((task) => {
          const Icon = task.icon;

          return (
            <div key={task.id} className={`card-elevated p-5 transition-all duration-200 ${task.completed ? "border-success/30 bg-success/5" : ""}`}>
              <div className="flex items-start gap-4">
                {/* Completion toggle */}
                <button
                  type="button"
                  onClick={() => {
                    if (task.panelAction && !task.completed) {
                      if (task.panelId && task.panelId in LEGAL_PANELS) setLegalPanelId(task.panelId as keyof typeof LEGAL_PANELS);
                      else setAgreementOpen(true);
                    } else {
                      toggleTask(task.id);
                    }
                  }}
                  className="flex-shrink-0 mt-0.5"
                  disabled={loadingId === task.id}
                  title={
                    task.panelAction && !task.completed
                      ? "Use the agreement panel to complete this"
                      : `Mark "${task.title}" as ${task.completed ? "incomplete" : "complete"}`
                  }
                  aria-label={`Mark "${task.title}" as ${task.completed ? "incomplete" : "complete"}`}
                >
                  {task.completed ? (
                    <CheckCircle2 className="h-7 w-7 text-success drop-shadow-[0_0_4px_hsl(var(--success)/0.4)]" />
                  ) : (
                    <div className={`h-7 w-7 rounded-full border-2 ${task.panelAction ? "border-muted-foreground/30" : "border-primary/60 hover:border-primary hover:bg-primary/10 cursor-pointer"} transition-all`} />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold ${task.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {task.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>

                  {/* Action button — aligned with text */}
                  <div className="mt-2">
                    {task.panelAction ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={task.completed}
                        onClick={() => {
                          if (task.panelId && task.panelId in LEGAL_PANELS) setLegalPanelId(task.panelId as keyof typeof LEGAL_PANELS);
                          else setAgreementOpen(true);
                        }}
                      >
                        <Icon className="h-4 w-4 mr-1" />
                        Review
                      </Button>
                    ) : task.external ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExternalVisit(task.id, task.action)}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open
                      </Button>
                    ) : (
                      <Link to={task.action}>
                        <Button variant="outline" size="sm" disabled={task.completed}>
                          Start
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {allComplete && (
        <div className="mt-8 card-elevated border-success/50 bg-success/5 p-6 text-center animate-fade-in">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
          <h2 className="text-xl font-bold text-foreground mb-2">🎉 Onboarding Complete!</h2>
          <p className="text-muted-foreground mb-4">You've unlocked Build an Agile Mindset.</p>
          <Link to="/courses/agile-mindset"><Button>Continue to Build an Agile Mindset</Button></Link>
        </div>
      )}

      <CommunityAgreementPanel
        open={agreementOpen}
        onOpenChange={setAgreementOpen}
        onAccepted={() => handlePanelAccepted("community-agreement")}
        loading={loadingId === "community-agreement"}
      />
      {legalPanelId && (
        <LegalPolicyPanel
          open={legalPanelId !== null}
          onOpenChange={(o) => { if (!o) setLegalPanelId(null); }}
          onAccepted={() => handlePanelAccepted(legalPanelId)}
          loading={loadingId === legalPanelId}
          panelKey={legalPanelId}
          title={LEGAL_PANELS[legalPanelId].title}
          description={LEGAL_PANELS[legalPanelId].description}
          policyKey={LEGAL_PANELS[legalPanelId].policyKey}
          downloadUrl={LEGAL_PANELS[legalPanelId].downloadUrl}
          acceptLabel={LEGAL_PANELS[legalPanelId].acceptLabel}
        />
      )}
      {/* 🎉 Course completion popup */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader className="items-center">
            <div className="text-5xl mb-2">🎉</div>
            <DialogTitle className="text-xl">
              Onboarding Steps Complete!
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              You've completed all onboarding tasks. You're ready for the next course!
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setShowCompletionDialog(false); navigate("/courses/agile-mindset"); }}>
              Continue to Build an Agile Mindset
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button variant="outline" onClick={() => setShowCompletionDialog(false)}>
              Stay on This Page
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
