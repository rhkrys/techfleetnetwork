/**
 * ProfileDiscordConnector — single source of truth for the Discord connect
 * experience across the entire app. Mirrors the Discord course (ConnectDiscordPage)
 * step-for-step so every surface (General Application, Profile Setup, Edit Profile,
 * etc.) gets the identical verified-link flow:
 *
 *   1. Ask  → "Are you in the Tech Fleet Discord?"
 *   2. Invite path (no/has account) → generate personal invite + tutorial
 *   3. Verify path → search by username/display name → pick from candidates
 *   4. Finalize → assign Community role, save Discord avatar (if profile has none),
 *      mark journey task complete, refresh profile, optional onLinked callback.
 *
 * Props let host pages tune presentation (heading, intro, completion behavior)
 * without ever forking the verification logic. Never reintroduce a raw
 * <Input id="discord_username"> elsewhere — guarded by ESLint rule.
 *
 * Nielsen heuristics covered: status visibility (aria-live + spinners + Verified
 * badge), error recovery (stale-candidate cleanup + plain-language messages),
 * user control (re-link), consistency across surfaces, recognition (candidate
 * picker + tutorial), error prevention (server-side resolve before write).
 */
import { useEffect, useRef, useState } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import DiscordUsernameTutorial from "@/components/DiscordUsernameTutorial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  DISCORD_MEMBER_NOT_VISIBLE_MESSAGE,
  DiscordNotifyService,
} from "@/services/discord-notify.service";
import { JourneyService } from "@/services/journey.service";
import { useQueryClient } from "@/lib/react-query";
import { toast } from "sonner";
import {
  isUsableDiscordUsername,
  normalizeDiscordSearchInput,
} from "@/lib/discord/username";

const TASK_ID = "connect-discord";
const PHASE = "first_steps" as const;
const COMMUNITY_ROLE_ID = "1083439364975112293";

type Candidate = {
  id: string;
  username: string;
  display_name?: string | null;
  global_name: string | null;
  nick?: string | null;
  avatar?: string | null;
};

type Step =
  | "ask"
  | "no-discord-choose"
  | "no-discord-no-account"
  | "no-discord-has-account"
  | "yes-discord";

export interface ProfileDiscordConnectorProps {
  /** Optional heading override (defaults to "Discord account"). */
  heading?: string;
  /** Optional intro copy below the heading. */
  intro?: string;
  /** Hide the header chrome entirely (host renders its own). */
  hideHeader?: boolean;
  /** Fires once after a successful verified link (e.g. open a completion dialog). */
  onLinked?: () => void;
  /** Where to start the flow when not yet linked. Defaults to "ask". */
  initialStep?: Step;
  /** Visual container variant. "card" = bordered card (default). "bare" = no border/padding. */
  variant?: "card" | "bare";
}

function formatDiscordAccountLabel(account: {
  username?: string | null;
  display_name?: string | null;
  global_name?: string | null;
  nick?: string | null;
}) {
  const accountName =
    account.display_name ||
    account.nick ||
    account.global_name ||
    account.username ||
    "Discord member";
  const accountUsername = account.username ? `@${account.username}` : "@unknown";
  return `${accountName} - ${accountUsername}`;
}

export function ProfileDiscordConnector({
  heading = "Discord account",
  intro = "Connect your account through the verified Tech Fleet Discord flow.",
  hideHeader = false,
  onLinked,
  initialStep = "ask",
  variant = "card",
}: ProfileDiscordConnectorProps = {}) {
  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

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

  // Verify flow
  const [username, setUsername] = useState(profile?.discord_username || "");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [linkedDiscordUsername, setLinkedDiscordUsername] = useState(
    profile?.discord_username || "",
  );
  const [status, setStatus] = useState(""); // aria-live announcement
  const onLinkedFiredRef = useRef(false);

  useEffect(() => {
    if (!relinking) {
      setUsername(profile?.discord_username || "");
      setLinkedDiscordUsername(profile?.discord_username || "");
    }
  }, [profile?.discord_username, relinking]);

  const displayName =
    profile?.display_name ||
    profile?.first_name ||
    user?.user_metadata?.full_name ||
    "A member";

  const clearStaleCandidate = (candidateId: string) => {
    setCandidates((current) => current.filter((c) => c.id !== candidateId));
    setConfirmingId(null);
  };

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

  const assignCommunityRole = async (discordUserId: string) => {
    const session = await getSessionSafe();
    if (!session) throw new Error("Not authenticated");
    const res = await supabase.functions.invoke("manage-discord-roles", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { action: "assign", discord_user_id: discordUserId, role_id: COMMUNITY_ROLE_ID },
    });
    if (res.error) throw new Error(res.error.message || "Failed to assign the Community role");
  };

  /** Download Discord avatar → upload to avatars bucket (only when profile has none). */
  const saveDiscordAvatar = async (discordAvatarUrl: string, userId: string) => {
    try {
      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("user_id", userId)
        .single();
      if (currentProfile?.avatar_url) return;

      const response = await fetch(discordAvatarUrl);
      if (!response.ok) return;
      const blob = await response.blob();
      const path = `${userId}/avatar.png`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/png" });
      if (uploadError) return;
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl } as any)
        .eq("user_id", userId);
    } catch {
      /* avatar save is best-effort, never blocks linking */
    }
  };

  const finalizeLinking = async (
    discordUserId: string,
    discordUsername: string,
    avatarUrl?: string | null,
    selectedLabel?: string,
  ) => {
    if (!user) throw new Error("Not authenticated");

    // Avatar save is fire-and-forget — never blocks the link
    if (avatarUrl) saveDiscordAvatar(avatarUrl, user.id);

    await JourneyService.upsertTask(user.id, PHASE, TASK_ID, true);

    let communityRoleAssigned = false;
    try {
      await assignCommunityRole(discordUserId);
      communityRoleAssigned = true;
    } catch {
      /* role sync retry queue + admin permissions are non-blocking */
    }

    DiscordNotifyService.discordVerified(displayName, discordUsername, discordUserId);

    queryClient.invalidateQueries({ queryKey: ["journey-completed", user.id, PHASE] });
    queryClient.invalidateQueries({ queryKey: ["journey-progress", user.id, PHASE] });

    setLinkedDiscordUsername(discordUsername);
    await refreshProfile();
    setRelinking(false);
    setCandidates([]);
    setVerifyError("");
    setStatus("Discord account verified and linked.");

    const successMsg = communityRoleAssigned
      ? selectedLabel
        ? `Selected ${selectedLabel}. Discord account verified, linked, and added to Community!`
        : "Discord account verified, linked, and added to Community!"
      : selectedLabel
        ? `Selected ${selectedLabel}. Discord account verified and linked!`
        : "Discord account verified and linked!";
    toast.success(successMsg, { duration: 30000, position: "top-center" });

    if (!onLinkedFiredRef.current && onLinked) {
      onLinkedFiredRef.current = true;
      onLinked();
    }
  };

  const verifyUsername = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setVerifyError("Please enter your Discord username or display name.");
      return;
    }
    const normalized = normalizeDiscordSearchInput(trimmed);
    setVerifying(true);
    setVerifyError("");
    setCandidates([]);
    setStatus("Searching the Tech Fleet Discord server…");

    try {
      const result = await DiscordNotifyService.resolveDiscordId(normalized);
      if (result.candidates?.length) {
        setCandidates(result.candidates);
        setStatus(`Found ${result.candidates.length} matching member${result.candidates.length === 1 ? "" : "s"}. Select yours to link.`);
      } else if (result.discord_user_id) {
        setVerifyError("Please select your Discord account from the search results before linking.");
        setStatus("");
      } else {
        const msg = result.message ||
          "We couldn't find that name in the Tech Fleet Discord server. Please make sure you've joined and that the username or display name is correct.";
        setVerifyError(msg);
        setStatus("");
      }
    } catch (err: any) {
      setVerifyError(err.message || "Discord verification is temporarily unavailable. Please try again in a minute.");
      setStatus("");
    } finally {
      setVerifying(false);
    }
  };

  const selectCandidate = async (candidate: Candidate) => {
    setConfirmingId(candidate.id);
    setVerifyError("");
    try {
      const confirmed = await DiscordNotifyService.confirmDiscordId(candidate.id);
      if (!confirmed?.discord_user_id) throw new Error(DISCORD_MEMBER_NOT_VISIBLE_MESSAGE);
      const selectedUsername = confirmed.discord_username || candidate.username;
      const selectedLabel = formatDiscordAccountLabel({
        username: selectedUsername,
        display_name: confirmed.discord_display_name || candidate.display_name,
        global_name: confirmed.global_name || candidate.global_name,
        nick: confirmed.nick || candidate.nick,
      });
      setUsername(selectedUsername);
      await finalizeLinking(confirmed.discord_user_id, selectedUsername, candidate.avatar, selectedLabel);
    } catch (err: any) {
      const message = err.message || "Verification failed. Please try again.";
      if (message === DISCORD_MEMBER_NOT_VISIBLE_MESSAGE) {
        clearStaleCandidate(candidate.id);
        setVerifyError(`${message} I removed that stale result so you can search again now.`);
        return;
      }
      setVerifyError(message);
    } finally {
      setConfirmingId(null);
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
              <h3 id="profile-discord-heading" className="font-semibold text-foreground">{heading}</h3>
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
              const candidate = linkedDiscordUsername || profile?.discord_username;
              return isUsableDiscordUsername(candidate)
                ? <>Connected as <strong className="text-foreground">@{candidate}</strong>.</>
                : <>Connected to Discord. <span className="text-foreground/70">Your username will refresh automatically.</span></>;
            })()}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => { setRelinking(true); setStep("yes-discord"); }}>
            Re-link a different account
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Step 1: Ask */}
          {step === "ask" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Tech Fleet's community lives on Discord. We'll verify your membership before linking your accounts.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setStep("yes-discord")} className="gap-2">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Yes, I'm in Discord
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep("no-discord-choose")}>
                  No, I need an invite
                </Button>
              </div>
            </div>
          )}

          {/* Step 1b: Has Discord account? */}
          {step === "no-discord-choose" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Discord is a free communication platform. If you don't have an account yet, we'll help you get set up.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setStep("no-discord-has-account")} className="gap-2">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Yes, I have Discord
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep("no-discord-no-account")}>
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
                Discord is a free platform for text, voice, and video. Follow these steps to get started:
              </p>
              <ol className="list-decimal list-inside space-y-3 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Download Discord</strong> — Get the app for your device or use the web version.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href="https://discord.com/download" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Download Discord
                    </a>
                    <a href="https://discord.com/app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Use in Browser
                    </a>
                  </div>
                </li>
                <li>
                  <strong className="text-foreground">Create your account</strong> — Pick a username and verify your email address.
                </li>
                <li>
                  <strong className="text-foreground">Come back here</strong> — Once your Discord account is ready, generate your personal invite link below.
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("no-discord-choose")}>Back</Button>
            </div>
          )}

          {/* Step 2a-ii: Has account — just invite */}
          {step === "no-discord-has-account" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Get your personal invite link to join the Tech Fleet Discord server. Once you've joined, come back here and verify your username.
              </p>
              <InviteBlock
                inviteUrl={inviteUrl}
                copied={copied}
                generating={generating}
                onGenerate={generateInvite}
                onCopy={copyInvite}
                onJoined={() => setStep("yes-discord")}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("no-discord-choose")}>Back</Button>
            </div>
          )}

          {/* Step 2b: Verify */}
          {step === "yes-discord" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your Discord username or display name and we'll find you in the Tech Fleet server.
              </p>

              <DiscordUsernameTutorial />

              <div className="space-y-2">
                <Label htmlFor="profile-discord-username">Discord username or display name</Label>
                <Input
                  id="profile-discord-username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setVerifyError(""); setCandidates([]); }}
                  placeholder="e.g. johndoe or John D."
                  disabled={verifying || !!confirmingId}
                  autoComplete="off"
                  aria-invalid={!!verifyError}
                  aria-describedby={verifyError ? "profile-discord-error" : undefined}
                />
              </div>

              {verifyError && (
                <div id="profile-discord-error" className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{verifyError}</span>
                </div>
              )}

              {candidates.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">We found similar members — is one of these you?</p>
                  <div className="space-y-2" role="list" aria-label="Matching Discord members">
                    {candidates.map((c) => (
                      <div key={c.id} role="listitem">
                        <button
                          type="button"
                          onClick={() => selectCandidate(c)}
                          disabled={!!confirmingId}
                          className="flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          aria-label={`Select ${c.global_name || c.nick || c.username}`}
                        >
                          {c.avatar ? (
                            <img src={c.avatar} alt="" className="h-10 w-10 rounded-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                              {(c.global_name || c.username || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{formatDiscordAccountLabel(c)}</p>
                            {c.nick && c.nick !== c.global_name && (
                              <p className="truncate text-xs text-muted-foreground">{c.nick}</p>
                            )}
                          </div>
                          {confirmingId === c.id
                            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                            : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    None of these? Try searching with your exact Discord username (Settings → My Account).
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={verifyUsername} disabled={verifying || !!confirmingId || !username.trim()} className="gap-2">
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {candidates.length > 0 ? "Search again" : "Verify Discord account"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setStep("no-discord-choose")} disabled={verifying || !!confirmingId}>
                  I need an invite instead
                </Button>
                {relinking && (
                  <Button type="button" variant="ghost" onClick={() => { setRelinking(false); setVerifyError(""); setCandidates([]); }}>
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
  inviteUrl, copied, generating, onGenerate, onCopy, onJoined,
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
        {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
        {generating ? "Generating…" : "Get my Discord invite"}
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open Discord invite
        </a>
        <Button type="button" variant="outline" size="sm" onClick={onCopy} className="shrink-0 gap-2">
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onGenerate} disabled={generating} className="shrink-0 gap-2">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          I need another link
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        This is a single-use invite link valid for 7 days.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onJoined} className="gap-2">
        I've joined — verify my username
      </Button>
    </div>
  );
}
