/**
 * ConnectDiscordPage — page chrome wrapper around <ProfileDiscordConnector />.
 *
 * The full verified-link flow (ask → invite → verify → candidate picker →
 * avatar save → Community role → journey task completion) lives in the shared
 * component so every surface (General Application, Profile Setup, Edit Profile,
 * etc.) ships the identical UX. This page only owns the route-level concerns:
 * breadcrumbs, loading state, and the celebration dialog that routes the
 * member to the next onboarding step.
 */
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Loader2, MessageSquare } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useJourneyProgress } from "@/hooks/use-journey-progress";
import { ProfileDiscordConnector } from "@/components/profile/ProfileDiscordConnector";

const TASK_ID = "connect-discord";
const PHASE = "first_steps" as const;

export const TOTAL_CONNECT_DISCORD = 1;
export const CONNECT_DISCORD_TASK_IDS = [TASK_ID] as const;

export default function ConnectDiscordPage() {
  const { user, profileLoaded } = useAuth();
  const navigate = useNavigate();
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const completionShownRef = useRef(false);

  const { isLoading: progressLoading } = useJourneyProgress(user?.id, PHASE);
  const dataReady = profileLoaded && !progressLoading;

  if (!dataReady) {
    return (
      <div className="container-app py-8 sm:py-12 max-w-2xl flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 max-w-2xl">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/courses">Courses</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Connect to Discord</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Connect to Discord</h1>
          <p className="text-muted-foreground text-sm">
            Link your Discord account to the Tech Fleet Network.
          </p>
        </div>
      </div>

      <ProfileDiscordConnector
        heading="Discord account"
        intro="Link your account through the verified Tech Fleet Discord flow."
        onLinked={() => {
          if (completionShownRef.current) return;
          completionShownRef.current = true;
          setShowCompletionDialog(true);
        }}
      />

      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader className="items-center">
            <div className="text-5xl mb-2">🎉</div>
            <DialogTitle className="text-xl">Connect to Discord complete!</DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              You've successfully connected your Discord account. You're ready for the next step!
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setShowCompletionDialog(false); navigate("/courses/onboarding"); }}>
              Continue to onboarding steps
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
            <Button variant="outline" onClick={() => setShowCompletionDialog(false)}>
              Stay on this page
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
