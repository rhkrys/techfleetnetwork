/**
 * ProfileDiscordConnector — single source of truth for the Discord connect
 * experience across the entire app. Used by General Application, Profile Setup,
 * Edit Profile, the Discord course, etc. so every surface ships the identical
 * verified-link flow:
 *
 *   1. Ask  → "Are you in the Tech Fleet Discord?"
 *   2. Invite path (no/has account) → generate personal invite + tutorial
 *   3. Verify path → "Continue with Discord" → Discord OAuth (audit H11):
 *      the user authorizes Tech Fleet, Discord returns to
 *      /courses/connect-discord/callback, and discord-oauth-callback binds the
 *      account only after proving ownership via /users/@me. Finalize (Community
 *      role, avatar, journey task) runs on the callback page.
 *
 * Why OAuth: the previous "search a username → pick a candidate → confirm" bind
 * had NO proof the caller controlled the Discord account (audit H11). OAuth makes
 * the snowflake come authoritatively from Discord for the account that authorized,
 * so a member can never claim someone else's identity.
 *
 * Props let host pages tune presentation without forking the verification logic.
 */
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getSessionSafe } from "@/lib/auth/session-port";
import { beginDiscordOAuth } from "@/lib/discord/oauth-link";
import { isUsableDiscordUsername } from "@/lib/discord/username";
import { toast } from "sonner";

type Step =
  "ask" | "no-discord-choose" | "no-discord-no-account" | "no-discord-has-account" | "yes-discord";

export interface ProfileDiscordConnectorProps {
  /** Optional heading override (defaults to "Discord account"). */
  heading?: string;
  /** Optional intro copy below the heading. */
  intro?: string;
  /** Hide the header chrome entirely (host renders its own). */
  hideHeader?: boolean;
  /**
   * Fires once after a successful verified link. NOTE: with the OAuth flow the
   * link completes on the callback page (/courses/connect-discord/callback), so
   * this connector redirects away before linking finishes — `onLinked` is
   * retained for API compatibility and only fires if a link somehow completes
   * without navigation. The callback page owns the post-link celebration.
   */
  onLinked?: () => void;
  /** Where to start the flow when not yet linked. Defaults to "ask". */
  initialStep?: Step;
  /** Visual container variant. "card" = bordered card (default). "bare" = no border/padding. */
  variant?: "card" | "bare";
}

export function ProfileDiscordConnector({
  heading = "Discord account",
  intro = "Connect your account through the verified Tech Fleet Discord flow.",
  hideHeader = false,
  onLinked: _onLinked,
  initialStep = "ask",
  variant = "card",
}: ProfileDiscordConnectorProps = {}) {
  const { profile } = useAuth();

  // Linked state — source of truth is profile.discord_user_id
  const isLinked = Boolean(profile?.discord_user_id);
  const [relinking, setRelinking] = useState(false);
  const showLinkedView = isLinked && !relinking;

  // Step state — for unlinked flow
  const [step, setStep] = useState<Step>(initialStep);

  // Invite flow
  const [inviteUrl, setInviteUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Verify (OAuth) flow
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [status, setStatus] = useState(""); // aria-live announcement

  const generateInvite = async () => {
    setGenerating(true);
    setStatus("Generating your personal Discord invite…");
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("generate-discord-invite", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error(res.error.message || "Failed to generate invite");
      const url = res.data?.invite_url;
      if (!url) throw new Error("No invite URL returned");
      setInviteUrl(url);
      setStatus("Your invite link is ready.");
      toast.success("Your personal Discord invite link is ready!", {
        duration: 5000,
        position: "top-center",
      });
    } catch (err: any) {
      setStatus("");
      toast.error(err.message || "Failed to generate invite link", {
        duration: 30000,
        position: "top-center",
      });
    } finally {
      setGenerating(false);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Invite link copied!", { duration: 5000, position: "top-center" });
    } catch {
      toast.error("Could not copy to clipboard", { duration: 30000, position: "top-center" });
    }
  };

  const connectWithDiscord = async () => {
    setStarting(true);
    setStartError("");
    setStatus("Redirecting you to Discord to verify ownership…");
    try {
      // On success the browser navigates to Discord and never returns here.
      await beginDiscordOAuth();
    } catch (err: any) {
      setStarting(false);
      setStatus("");
      setStartError(
        err?.message || "Could not start Discord linking. Please try again in a minute."
      );
    }
  };

  const containerClass =
    variant === "card"
      ? "rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4"
      : "space-y-4";

  return (
    <section className={containerClass} aria-labelledby="profile-discord-heading">
      {/* aria-live status announcer for screen readers */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>

      {!hideHeader && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 id="profile-discord-heading" className="font-semibold text-foreground">
                {heading}
              </h3>
              <p className="text-sm text-muted-foreground">{intro}</p>
            </div>
          </div>
          {showLinkedView && (
            <Badge variant="outline" className="bg-success/10 text-success border-success/20">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Verified
            </Badge>
          )}
        </div>
      )}

      {/* === Linked view === */}
      {showLinkedView ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {(() => {
              const candidate = profile?.discord_username;
              return isUsableDiscordUsername(candidate) ? (
                <>
                  Connected as <strong className="text-foreground">@{candidate}</strong>.
                </>
              ) : (
                <>
                  Connected to Discord.{" "}
                  <span className="text-foreground/70">
                    Your username will refresh automatically.
                  </span>
                </>
              );
            })()}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRelinking(true);
              setStep("yes-discord");
            }}
          >
            Re-link a different account
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Step 1: Ask */}
          {step === "ask" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Tech Fleet's community lives on Discord. We'll verify your membership before linking
                your accounts.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep("yes-discord")}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Yes, I'm in Discord
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep("no-discord-choose")}
                >
                  No, I need an invite
                </Button>
              </div>
            </div>
          )}

          {/* Step 1b: Has Discord account? */}
          {step === "no-discord-choose" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Discord is a free communication platform. If you don't have an account yet, we'll
                help you get set up.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep("no-discord-has-account")}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Yes, I have Discord
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep("no-discord-no-account")}
                >
                  No, I need to create one
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("ask")}>
                  Back
                </Button>
              </div>
            </div>
          )}

          {/* Step 2a-i: No account — setup guidance */}
          {step === "no-discord-no-account" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Discord is a free platform for text, voice, and video. Follow these steps to get
                started:
              </p>
              <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Download Discord</strong> — Get the app for
                  your device or use the web version.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href="https://discord.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Download Discord
                    </a>
                    <a
                      href="https://discord.com/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Use in Browser
                    </a>
                  </div>
                </li>
                <li>
                  <strong className="text-foreground">Create your account</strong> — Pick a username
                  and verify your email address.
                </li>
                <li>
                  <strong className="text-foreground">Come back here</strong> — Once your Discord
                  account is ready, generate your personal invite link below.
                </li>
              </ol>
              <InviteBlock
                inviteUrl={inviteUrl}
                copied={copied}
                generating={generating}
                onGenerate={generateInvite}
                onCopy={copyInvite}
                onJoined={() => setStep("yes-discord")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("no-discord-choose")}
              >
                Back
              </Button>
            </div>
          )}

          {/* Step 2a-ii: Has account — just invite */}
          {step === "no-discord-has-account" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Get your personal invite link to join the Tech Fleet Discord server. Once you've
                joined, come back here and verify your account.
              </p>
              <InviteBlock
                inviteUrl={inviteUrl}
                copied={copied}
                generating={generating}
                onGenerate={generateInvite}
                onCopy={copyInvite}
                onJoined={() => setStep("yes-discord")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("no-discord-choose")}
              >
                Back
              </Button>
            </div>
          )}

          {/* Step 2b: Verify via Discord OAuth */}
          {step === "yes-discord" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                We'll send you to Discord to authorize Tech Fleet, then bring you right back. This
                proves you own the account before we link it — no one else can claim your Discord
                identity.
              </p>

              {startError && (
                <div
                  id="profile-discord-error"
                  className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{startError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={connectWithDiscord}
                  disabled={starting}
                  className="gap-2"
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  )}
                  {starting ? "Redirecting to Discord…" : "Continue with Discord"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("no-discord-choose")}
                  disabled={starting}
                >
                  I need an invite instead
                </Button>
                {relinking && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setRelinking(false);
                      setStartError("");
                    }}
                    disabled={starting}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Shared invite block ──────────────────────────────────────────────
function InviteBlock({
  inviteUrl,
  copied,
  generating,
  onGenerate,
  onCopy,
  onJoined,
}: {
  inviteUrl: string;
  copied: boolean;
  generating: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onJoined: () => void;
}) {
  if (!inviteUrl) {
    return (
      <Button type="button" onClick={onGenerate} disabled={generating} className="gap-2">
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
        )}
        {generating ? "Generating…" : "Get my Discord invite"}
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open Discord invite
        </a>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCopy}
          className="shrink-0 gap-2"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onGenerate}
          disabled={generating}
          className="shrink-0 gap-2"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          I need another link
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        This is a single-use invite link valid for 7 days.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onJoined} className="gap-2">
        I've joined — verify my account
      </Button>
    </div>
  );
}
