import { useState } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import { MessageSquare, ExternalLink, Copy, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/design-system";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Shows a personalized Discord invite banner for users who indicated
 * they don't have a Discord account or haven't joined yet.
 * Generates a unique single-use invite link via the Discord Bot API.
 */
export function DiscordInviteBanner() {
  const { user, profile } = useAuth();
  // Never load a stored invite — invites are single-use and ephemeral
  const [inviteUrl, setInviteUrl] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Don't show if user already has a Discord username or has an account
  const hasDiscord = profile?.discord_username && profile.discord_username.trim() !== "";
  const hasAccount = (profile as any)?.has_discord_account === true;
  if (hasDiscord || hasAccount || !user) return null;

  const generateInvite = async () => {
    setGenerating(true);
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
      toast.success("Your personal Discord invite link is ready!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate invite link");
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Invite link copied!");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div
      className="rounded-lg border border-primary/20 bg-primary/5 p-4 sm:p-5"
      role="region"
      aria-label="Discord invite"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 flex-shrink-0" aria-hidden="true">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <h3 className="font-semibold text-foreground text-sm">Join Tech Fleet on Discord</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tech Fleet's community lives on Discord. Get your personal invite link to join and
            connect with other members, attend events, and collaborate on projects.
          </p>

          {inviteUrl ? (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <a
                href={inviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Open Discord Invite
              </a>
              <Button variant="outline" size="sm" onClick={copyToClipboard} className="gap-2">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy Link"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateInvite}
                disabled={generating}
                className="gap-2"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                I need another link
              </Button>
            </div>
          ) : (
            <Button onClick={generateInvite} disabled={generating} size="sm" className="gap-2 mt-1">
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <MessageSquare className="h-4 w-4" />
                  Get My Discord Invite
                </>
              )}
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground">
            This is a single-use invite link valid for 7 days.
          </p>
        </div>
      </div>
    </div>
  );
}
