import { useState, useEffect, useCallback, useRef } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import { Search, Plus, Check, Loader2, MessageSquare, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
}

interface DiscordRolePickerProps {
  selectedRoleId: string;
  selectedRoleName: string;
  onSelect: (roleId: string, roleName: string) => void;
}

export function DiscordRolePicker({
  selectedRoleId,
  selectedRoleName,
  onSelect,
}: DiscordRolePickerProps) {
  const [mode, setMode] = useState<"idle" | "search" | "create">("idle");
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchRoles = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("manage-discord-roles", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: "list", search: query || undefined },
      });

      if (res.error) throw new Error(res.error.message || "Failed to fetch roles");
      setRoles(res.data?.roles ?? []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load Discord roles");
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when entering search mode
  useEffect(() => {
    if (mode === "search") {
      fetchRoles();
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [mode, fetchRoles]);

  // Debounced search
  useEffect(() => {
    if (mode !== "search") return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchRoles(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search, mode, fetchRoles]);

  const handleSelectRole = (role: DiscordRole) => {
    onSelect(role.id, role.name);
    setMode("idle");
    setSearch("");
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("manage-discord-roles", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: "create", name },
      });

      if (res.error) {
        const errBody = res.data?.error;
        if (errBody === "Failed to create Discord role") {
          throw new Error("Discord bot lacks 'Manage Roles' permission. Please check bot permissions in Discord server settings.");
        }
        throw new Error(res.error.message || "Failed to create role");
      }
      const role = res.data?.role;
      if (!role) throw new Error("No role returned");

      onSelect(role.id, role.name);
      toast.success(`Discord role "${role.name}" created`);
      setMode("idle");
      setNewRoleName("");
    } catch (err: any) {
      toast.error(err.message || "Failed to create Discord role");
    } finally {
      setCreating(false);
    }
  };

  const handleClear = () => {
    onSelect("", "");
  };

  // Color int to hex
  const colorToHex = (color: number) => {
    if (!color) return undefined;
    return `#${color.toString(16).padStart(6, "0")}`;
  };

  return (
    <div className="space-y-2">
      <Label>
        <MessageSquare className="inline h-3.5 w-3.5 mr-1" />
        Discord Role
      </Label>

      {/* Currently selected */}
      {selectedRoleId && mode === "idle" ? (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm gap-1.5 py-1 px-2.5">
            <MessageSquare className="h-3 w-3" />
            {selectedRoleName || selectedRoleId}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setMode("search")}
          >
            Change
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            aria-label="Remove Discord role"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : mode === "idle" ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setMode("search")}
          >
            <Search className="h-3.5 w-3.5" />
            Select Existing Role
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setMode("create")}
          >
            <Plus className="h-3.5 w-3.5" />
            Create New Role
          </Button>
        </div>
      ) : null}

      {/* Search mode */}
      {mode === "search" && (
        <div data-no-card className="space-y-2 rounded-md border bg-popover p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles by name..."
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => { setMode("idle"); setSearch(""); }}
            >
              Cancel
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : roles.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              {search ? "No roles match your search" : "No roles found in the server"}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => handleSelectRole(role)}
                  className={`w-full flex items-center gap-2 rounded px-2.5 py-1.5 text-sm text-left transition-colors
                    hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${role.id === selectedRoleId ? "bg-accent" : ""}`}
                >
                  {colorToHex(role.color) && (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: colorToHex(role.color) }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate flex-1">{role.name}</span>
                  {role.id === selectedRoleId && (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="border-t pt-2 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs w-full"
              onClick={() => { setMode("create"); setSearch(""); }}
            >
              <Plus className="h-3.5 w-3.5" />
              Create a new role instead
            </Button>
          </div>
        </div>
      )}

      {/* Create mode */}
      {mode === "create" && (
        <div data-no-card className="space-y-2 rounded-md border bg-popover p-3">
          <Label htmlFor="new-role-name" className="text-xs">
            New Role Name
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="new-role-name"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value.slice(0, 100))}
              placeholder="e.g. Project: Acme Phase 1"
              className="h-8 text-sm flex-1"
              autoFocus
              maxLength={100}
            />
            <Button
              type="button"
              size="sm"
              className="gap-1.5 h-8"
              onClick={handleCreateRole}
              disabled={creating || !newRoleName.trim()}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              onClick={() => { setMode("idle"); setNewRoleName(""); }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            This role will be created in Discord with "Allow anyone to mention this role" enabled and no additional permissions.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs w-full"
            onClick={() => { setMode("search"); setNewRoleName(""); }}
          >
            <Search className="h-3.5 w-3.5" />
            Select an existing role instead
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Optional. Associate a Discord role for automated member role assignment.
      </p>
    </div>
  );
}
