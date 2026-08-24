import { useState, useCallback } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import {
  MessageSquare,
  UserPlus,
  UserMinus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/design-system";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DiscordRoleAssignmentProps {
  /** The project's associated Discord role ID */
  discordRoleId: string;
  /** The project's associated Discord role name */
  discordRoleName: string;
  /** The applicant's discord_user_id from their profile */
  applicantDiscordUserId: string;
  /** The applicant's discord username */
  applicantDiscordUsername: string;
  /** Display name for toast messages */
  applicantName: string;
}

export function DiscordRoleAssignment({
  discordRoleId,
  discordRoleName,
  applicantDiscordUserId,
  applicantDiscordUsername,
  applicantName,
}: DiscordRoleAssignmentProps) {
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState(false);

  const hasProjectRole = !!discordRoleId;
  const hasDiscordId = !!applicantDiscordUserId;

  const handleAssignRole = useCallback(async () => {
    if (!discordRoleId || !applicantDiscordUserId) return;
    setAssigning(true);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("manage-discord-roles", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: "assign", discord_user_id: applicantDiscordUserId, role_id: discordRoleId },
      });

      if (res.error) {
        const errBody = res.data?.error;
        throw new Error(errBody || res.error.message || "Failed to assign role");
      }

      toast.success(`Assigned "${discordRoleName}" to ${applicantName}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to assign Discord role";
      toast.error(message);
    } finally {
      setAssigning(false);
    }
  }, [discordRoleId, discordRoleName, applicantDiscordUserId, applicantName]);

  const handleRemoveRole = useCallback(async () => {
    if (!discordRoleId || !applicantDiscordUserId) return;
    setRemoving(true);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("manage-discord-roles", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: "remove", discord_user_id: applicantDiscordUserId, role_id: discordRoleId },
      });

      if (res.error) {
        const errBody = res.data?.error;
        throw new Error(errBody || res.error.message || "Failed to remove role");
      }

      toast.success(`Removed "${discordRoleName}" from ${applicantName}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to remove Discord role";
      toast.error(message);
    } finally {
      setRemoving(false);
    }
  }, [discordRoleId, discordRoleName, applicantDiscordUserId, applicantName]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">Discord Role Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Applicant Discord info */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Applicant Discord
          </p>
          {applicantDiscordUsername ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 py-1 px-2.5">
                <MessageSquare className="h-3 w-3" />
                {applicantDiscordUsername}
              </Badge>
              {hasDiscordId ? (
                <Badge className="bg-success/10 text-success border-success/30 gap-1 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  Not Verified
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No Discord username on profile</p>
          )}
        </div>

        {/* Project Discord role */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Project Role
          </p>
          {hasProjectRole ? (
            <Badge variant="outline" className="gap-1.5 py-1 px-2.5">
              <MessageSquare className="h-3 w-3" />
              {discordRoleName || discordRoleId}
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Discord role configured for this project. Set one in the project form.
            </p>
          )}
        </div>

        {/* Action buttons */}
        {hasProjectRole && hasDiscordId && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={handleAssignRole}
              disabled={assigning || removing}
            >
              {assigning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              Assign Role
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleRemoveRole}
              disabled={assigning || removing}
            >
              {removing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserMinus className="h-3.5 w-3.5" />
              )}
              Remove Role
            </Button>
          </div>
        )}

        {/* Warning states */}
        {hasProjectRole && !hasDiscordId && applicantDiscordUsername && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              This applicant's Discord account hasn't been verified yet. They need to verify their
              Discord on the platform before roles can be assigned.
            </p>
          </div>
        )}

        {hasProjectRole && !applicantDiscordUsername && (
          <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              This applicant hasn't added a Discord username to their profile yet.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
