/**
 * DiscordOAuthCallbackPage — the redirect target Discord returns to after the
 * user authorizes (audit H11 follow-up). It hands the `code` + `state` to the
 * `discord-oauth-callback` edge function (which proves ownership via /users/@me
 * and binds the account), then runs the shared finalize steps (Community role,
 * avatar, journey task) and shows a success/error card.
 *
 * The identity is NEVER trusted from the client — this page only forwards the
 * OAuth code and reacts to the server's verified result.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ChevronRight, Loader2, MessageSquare, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@/lib/react-query";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import { finalizeDiscordLink } from "@/lib/discord/finalize-link";
import { DISCORD_LINK_RETURN_KEY } from "@/lib/discord/oauth-link";

type Phase = "working" | "success" | "error";

export default function DiscordOAuthCallbackPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("working");
  const [errorMessage, setErrorMessage] = useState("");
  const ranRef = useRef(false);

  const returnPath =
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISCORD_LINK_RETURN_KEY)) ||
    "/courses/connect-discord";

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");

    const displayName =
      profile?.display_name || profile?.first_name || user?.user_metadata?.full_name || "A member";

    (async () => {
      // Discord sent us back without authorizing (user pressed "Cancel").
      if (oauthError || !code || !state) {
        setPhase("error");
        setErrorMessage(
          oauthError === "access_denied"
            ? "Discord linking was cancelled. You can try again whenever you're ready."
            : "We didn't get a valid response from Discord. Please try linking again."
        );
        return;
      }

      if (!user) {
        setPhase("error");
        setErrorMessage("Please sign in again, then retry linking your Discord account.");
        return;
      }

      try {
        const linked = await DiscordNotifyService.completeDiscordOAuth(code, state);
        await finalizeDiscordLink({
          userId: user.id,
          displayName,
          discordUserId: linked.discord_user_id,
          discordUsername: linked.discord_username,
          avatarUrl: linked.avatar,
          queryClient,
          refreshProfile,
        });
        try {
          sessionStorage.removeItem(DISCORD_LINK_RETURN_KEY);
        } catch {
          /* ignore */
        }
        setPhase("success");
      } catch (err) {
        setPhase("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Discord verification failed. Please try linking again."
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container-app py-8 sm:py-12 max-w-md">
      <div className="rounded-lg border border-border bg-card p-6 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
          <MessageSquare className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>

        {phase === "working" && (
          <div
            className="space-y-3"
            role="status"
            aria-live="polite"
            data-no-translate
            translate="no"
          >
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground">
              Verifying your Discord account…
            </h1>
            <p className="text-sm text-muted-foreground">
              We're confirming ownership with Discord and linking your account.
            </p>
          </div>
        )}

        {phase === "success" && (
          <div
            className="space-y-4"
            role="status"
            aria-live="polite"
            data-no-translate
            translate="no"
          >
            <div className="text-5xl" aria-hidden="true">
              🎉
            </div>
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground">Discord account linked!</h1>
            <p className="text-sm text-muted-foreground">
              Your ownership was verified and your account is connected to Tech Fleet.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={() => navigate("/courses/onboarding")}>
                Continue to onboarding steps
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" onClick={() => navigate(returnPath)}>
                Back to where I was
              </Button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4" role="alert" data-no-translate translate="no">
            <XCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-foreground">Couldn't link Discord</h1>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button variant="outline" onClick={() => navigate(returnPath)}>
              Back to try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
