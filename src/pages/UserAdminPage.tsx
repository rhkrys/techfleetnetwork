import { useEffect, useState, useMemo, useCallback } from "react";
import { getSessionSafe } from "@/lib/auth/session-port";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { UserActionsDropdown } from "@/components/admin/UserActionsDropdown";
import { UserDetailDialog } from "@/components/admin/UserDetailDialog";
import type { UserRow } from "@/components/admin/UserActionsDropdown";
import { StepUpMfaDialog } from "@/components/StepUpMfaDialog";

/**
 * Detect a "Fresh 2FA verification required" 403 from a privileged edge function.
 * Supabase functions.invoke surfaces non-2xx as FunctionsHttpError with the original
 * Response on `error.context`; the body's `error` field carries the message.
 */
async function isFresh2faRequired(invokeResult: {
  error: unknown;
  data: unknown;
}): Promise<boolean> {
  const err = invokeResult.error as { message?: string; context?: Response } | null;
  if (!err) return false;
  const direct = typeof err.message === "string" && /fresh\s*2fa/i.test(err.message);
  if (direct) return true;
  try {
    const ctx = err.context;
    if (ctx && typeof ctx.clone === "function") {
      const body = (await ctx
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      if (body?.error && /fresh\s*2fa/i.test(body.error)) return true;
      if (ctx.status === 403) return false;
    }
  } catch {
    // ignore
  }
  return false;
}

export default function UserAdminPage() {
  const { user } = useAuth();
  // Admin check is handled by AdminRoute wrapper
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [promoting, setPromoting] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<UserRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "promote" | "resend" | "delete" | "promote_teacher" | "revoke_teacher"
  >("promote");
  const [viewUser, setViewUser] = useState<UserRow | null>(null);
  // Accessibility-policy §10 commits to onboarding + annual a11y refresher.
  // We surface completion % so admins can see who still needs to take it.
  const [a11yTrainedIds, setA11yTrainedIds] = useState<Set<string>>(new Set());

  // Step-up 2FA: privileged edge functions (promote-to-admin, admin-purge-auth-user)
  // require a fresh TOTP proof. When they 403, we open this dialog and retry on success.
  const [stepUp, setStepUp] = useState<{
    actionLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const requestStepUp = (actionLabel: string) =>
    new Promise<boolean>((resolve) => setStepUp({ actionLabel, resolve }));

  /**
   * Invoke a privileged edge function; if it returns 403 "Fresh 2FA verification
   * required", prompt for a TOTP code and retry once.
   */
  const invokeWithStepUp = async (
    fnName: string,
    body: Record<string, unknown>,
    actionLabel: string
  ) => {
    let res = await supabase.functions.invoke(fnName, { body });
    if (res.error && (await isFresh2faRequired(res))) {
      const verified = await requestStepUp(actionLabel);
      if (!verified) {
        const err = new Error("Admin action cancelled.");
        (err as Error & { cancelled?: boolean }).cancelled = true;
        throw err;
      }
      res = await supabase.functions.invoke(fnName, { body });
    }
    return res;
  };

  const fetchData = async () => {
    try {
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("user_id, email, first_name, last_name, display_name, discord_username, created_at")
        .order("created_at", { ascending: false });
      if (profilesErr) throw profilesErr;

      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const adminIds = new Set(
        (roles || []).filter((r) => r.role === "admin").map((r) => r.user_id)
      );
      const teacherIds = new Set(
        (roles || []).filter((r) => r.role === "teacher").map((r) => r.user_id)
      );

      const { data: promos } = await supabase
        .from("admin_promotions")
        .select("user_id")
        .is("confirmed_at", null);
      const pendingIds = new Set((promos || []).map((p: { user_id: string }) => p.user_id));

      const { data: teacherPromos } = await supabase
        .from("teacher_promotions" as never)
        .select("user_id")
        .is("confirmed_at", null);
      const pendingTeacherIds = new Set(
        ((teacherPromos as { user_id: string }[] | null) || []).map((p) => p.user_id)
      );

      const { data: testFlags } = await supabase
        .from("profiles")
        .select("user_id, is_test_account")
        .eq("is_test_account", true);
      const testIds = new Set(
        ((testFlags as { user_id: string }[] | null) || []).map((r) => r.user_id)
      );

      const rows: UserRow[] = (profiles || []).map((p) => ({
        user_id: p.user_id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        display_name: p.display_name,
        discord_username: p.discord_username,
        created_at: p.created_at,
        isAdmin: adminIds.has(p.user_id),
        isTeacher: teacherIds.has(p.user_id),
        pendingPromotion: pendingIds.has(p.user_id),
        pendingTeacher: pendingTeacherIds.has(p.user_id),
        isTestAccount: testIds.has(p.user_id),
      }));
      setUsers(rows);

      // Pull a11y-training completions in a separate non-blocking call so a
      // missing/locked-down table never blanks out the admin grid.
      try {
        const { data: trained } = await supabase
          .from("accessibility_training_completions")
          .select("user_id");
        setA11yTrainedIds(new Set((trained || []).map((t: { user_id: string }) => t.user_id)));
      } catch (e) {
        // Soft-fail — surface a placeholder of 0% rather than crash.
        console.warn("[a11y-training] read failed:", e);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
      toast.error("We couldn't load the member list. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Legacy mount-fetch: every setState inside fetchData fires after an await
    // (async), so there is no synchronous set-state cascade; the react-hooks v7
    // rule can't see through the async boundary. Proper fix = React Query
    // refactor, tracked separately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, []);

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q) ||
        (u.discord_username ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const handlePromote = async (targetUser: UserRow) => {
    setPromoting(targetUser.user_id);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");
      const res = await invokeWithStepUp(
        "promote-to-admin",
        { user_id: targetUser.user_id },
        `promote ${targetUser.email} to admin`
      );
      if (res.error)
        throw new Error(
          res.error.message || "We couldn't promote that member. Try again in a moment."
        );
      const result = res.data;
      if (result?.error) throw new Error(result.error);
      toast.success(result?.message || "Confirmation email sent — they'll need to accept it.");
      await fetchData();
    } catch (err: unknown) {
      if ((err as Error & { cancelled?: boolean })?.cancelled) {
        toast.info("Admin action cancelled.");
      } else {
        const message =
          err instanceof Error
            ? err.message
            : "We couldn't promote that member. Try again in a moment.";
        toast.error(message);
      }
    } finally {
      setPromoting(null);
      setConfirmUser(null);
    }
  };

  const handleResendInvite = async (targetUser: UserRow) => {
    setPromoting(targetUser.user_id);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");
      const res = await invokeWithStepUp(
        "promote-to-admin",
        { user_id: targetUser.user_id },
        `resend the admin invite to ${targetUser.email}`
      );
      if (res.error)
        throw new Error(
          res.error.message || "We couldn't resend that invite. Try again in a moment."
        );
      const result = res.data;
      if (result?.error) throw new Error(result.error);
      toast.success(`Admin invite resent to ${targetUser.email}.`);
      await fetchData();
    } catch (err: unknown) {
      if ((err as Error & { cancelled?: boolean })?.cancelled) {
        toast.info("Admin action cancelled.");
      } else {
        const message =
          err instanceof Error
            ? err.message
            : "We couldn't resend that invite. Try again in a moment.";
        toast.error(message);
      }
    } finally {
      setPromoting(null);
      setConfirmUser(null);
    }
  };

  const handleDeleteUser = async (targetUser: UserRow) => {
    setPromoting(targetUser.user_id);
    try {
      const session = await getSessionSafe();
      if (!session) throw new Error("Not authenticated");
      const res = await invokeWithStepUp(
        "admin-purge-auth-user",
        { email: targetUser.email },
        `delete ${targetUser.email}`
      );
      if (res.error)
        throw new Error(
          res.error.message || "We couldn't delete that account. Try again in a moment."
        );
      const result = res.data;
      if (result?.error) throw new Error(result.error);
      toast.success(`Account for ${targetUser.email} deleted.`);
      await fetchData();
    } catch (err: unknown) {
      if ((err as Error & { cancelled?: boolean })?.cancelled) {
        toast.info("Admin action cancelled.");
      } else {
        const message =
          err instanceof Error
            ? err.message
            : "We couldn't delete that account. Try again in a moment.";
        toast.error(message);
      }
    } finally {
      setPromoting(null);
      setConfirmUser(null);
    }
  };

  const handlePromoteTeacher = async (targetUser: UserRow) => {
    setPromoting(targetUser.user_id);
    try {
      const res = await supabase.functions.invoke("promote-to-teacher", {
        body: { user_id: targetUser.user_id },
      });
      if (res.error)
        throw new Error(
          res.error.message || "We couldn't promote that teacher. Try again in a moment."
        );
      const result = res.data as { error?: string; message?: string } | null;
      if (result?.error) throw new Error(result.error);
      toast.success(
        result?.message || "Teacher confirmation email sent — they'll need to accept it."
      );
      await fetchData();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "We couldn't promote that teacher. Try again in a moment."
      );
    } finally {
      setPromoting(null);
      setConfirmUser(null);
    }
  };

  const handleRevokeTeacher = async (targetUser: UserRow) => {
    setPromoting(targetUser.user_id);
    try {
      const res = await supabase.functions.invoke("revoke-teacher-role", {
        body: { user_id: targetUser.user_id },
      });
      if (res.error)
        throw new Error(
          res.error.message || "We couldn't revoke that teacher role. Try again in a moment."
        );
      const result = res.data as { error?: string; message?: string } | null;
      if (result?.error) throw new Error(result.error);
      toast.success(result?.message || "Teacher role revoked.");
      await fetchData();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : "We couldn't revoke that teacher role. Try again in a moment."
      );
    } finally {
      setPromoting(null);
      setConfirmUser(null);
    }
  };

  const NameCellRenderer = useCallback((params: ICellRendererParams<UserRow>) => {
    const u = params.data;
    if (!u) return null;
    const name =
      u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.display_name || "—";
    return (
      <div className="flex items-center gap-2">
        <span className={u.isAdmin ? "text-primary" : "text-muted-foreground"}>
          {u.isAdmin ? "🛡" : "👤"}
        </span>
        <span className="font-medium">{name}</span>
      </div>
    );
  }, []);

  const RoleCellRenderer = useCallback((params: ICellRendererParams<UserRow>) => {
    const u = params.data;
    if (!u) return null;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {u.isAdmin && <span className="text-primary font-semibold text-xs">Admin</span>}
        {u.isTeacher && (
          <span className="text-accent-foreground font-semibold text-xs">Teacher</span>
        )}
        {!u.isAdmin && !u.isTeacher && u.pendingPromotion && (
          <span className="text-accent-foreground font-medium text-xs">Pending Admin</span>
        )}
        {!u.isAdmin && !u.isTeacher && !u.pendingPromotion && u.pendingTeacher && (
          <span className="text-accent-foreground font-medium text-xs">Pending Teacher</span>
        )}
        {!u.isAdmin && !u.isTeacher && !u.pendingPromotion && !u.pendingTeacher && (
          <span className="text-muted-foreground text-xs">Member</span>
        )}
      </div>
    );
  }, []);

  const ActionsCellRenderer = useCallback(
    (params: ICellRendererParams<UserRow>) => {
      const u = params.data;
      if (!u) return null;
      const isSelf = u.user_id === user?.id;
      return (
        <UserActionsDropdown
          user={u}
          isSelf={isSelf}
          onPromote={(usr) => {
            setConfirmAction("promote");
            setConfirmUser(usr);
          }}
          onResendInvite={(usr) => {
            setConfirmAction("resend");
            setConfirmUser(usr);
          }}
          onView={(usr) => setViewUser(usr)}
          onDelete={(usr) => {
            setConfirmAction("delete");
            setConfirmUser(usr);
          }}
          onPromoteTeacher={(usr) => {
            setConfirmAction("promote_teacher");
            setConfirmUser(usr);
          }}
          onRevokeTeacher={(usr) => {
            setConfirmAction("revoke_teacher");
            setConfirmUser(usr);
          }}
        />
      );
    },
    [user?.id]
  );

  const columnDefs = useMemo<ColDef<UserRow>[]>(
    () => [
      {
        headerName: "Name",
        field: "first_name",
        flex: 2,
        cellRenderer: NameCellRenderer,
        valueGetter: (params) => {
          const u = params.data;
          if (!u) return "";
          return u.first_name || u.last_name
            ? `${u.first_name} ${u.last_name}`.trim()
            : u.display_name || "";
        },
      },
      {
        headerName: "Email",
        field: "email",
        flex: 2,
      },
      {
        // The Discord HANDLE (profiles.discord_username, set from Discord's
        // member.user.username by resolve-discord-id) — NOT the friendly
        // global_name. Blank when the account has no linked handle.
        headerName: "Discord",
        field: "discord_username",
        flex: 1.5,
        valueGetter: (params) => params.data?.discord_username || "",
        cellRenderer: (params: ICellRendererParams<UserRow>) => {
          const handle = params.data?.discord_username;
          return handle ? <span className="text-xs font-mono">{handle}</span> : null;
        },
      },
      {
        headerName: "Joined",
        field: "created_at",
        flex: 1,
        valueFormatter: (params) =>
          params.value ? format(new Date(params.value), "MMM d, yyyy") : "—",
      },
      {
        headerName: "Role",
        field: "isAdmin",
        flex: 1,
        cellRenderer: RoleCellRenderer,
        valueGetter: (params) => {
          const u = params.data;
          if (!u) return "";
          if (u.isAdmin) return "Admin";
          if (u.pendingPromotion) return "Pending";
          return "Member";
        },
      },
      {
        headerName: "A11y Training",
        field: "user_id",
        flex: 1,
        valueGetter: (params) =>
          params.data && a11yTrainedIds.has(params.data.user_id) ? "Completed" : "Not yet",
        cellRenderer: (params: ICellRendererParams<UserRow>) => {
          const done = !!params.data && a11yTrainedIds.has(params.data.user_id);
          return (
            <span
              className={
                done ? "text-emerald-500 font-medium text-xs" : "text-muted-foreground text-xs"
              }
            >
              {done ? "✓ Completed" : "Not yet"}
            </span>
          );
        },
      },
      {
        headerName: "Test acct",
        field: "isTestAccount",
        flex: 1,
        headerTooltip: "Excludes this account from public network activity totals.",
        valueGetter: (params) => (params.data?.isTestAccount ? "Yes" : "No"),
        cellRenderer: (params: ICellRendererParams<UserRow>) => {
          const row = params.data;
          if (!row) return null;
          const isTest = !!row.isTestAccount;
          return (
            <button
              type="button"
              role="switch"
              aria-checked={isTest}
              aria-label={`Toggle test account for ${row.email}`}
              onClick={async () => {
                try {
                  const { error } = await supabase.rpc("admin_set_test_account", {
                    _user_id: row.user_id,
                    _is_test: !isTest,
                  });
                  if (error) throw error;
                  setUsers((prev) =>
                    prev.map((u) =>
                      u.user_id === row.user_id ? { ...u, isTestAccount: !isTest } : u
                    )
                  );
                  toast.success(!isTest ? "Marked as test account" : "Removed test account flag");
                } catch (e) {
                  toast.error((e as Error)?.message || "Couldn't update test account flag");
                }
              }}
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                isTest
                  ? "bg-warning/15 text-warning hover:bg-warning/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {isTest ? "Yes" : "No"}
            </button>
          );
        },
      },
      {
        headerName: "Actions",
        sortable: false,
        filter: false,
        resizable: false,
        width: 80,
        minWidth: 60,
        maxWidth: 100,
        pinned: "right",
        lockPinned: true,
        suppressSizeToFit: true,
        cellRenderer: ActionsCellRenderer,
      },
    ],
    [user?.id, NameCellRenderer, RoleCellRenderer, ActionsCellRenderer, a11yTrainedIds]
  );

  // Admin access is enforced by AdminRoute wrapper

  const confirmTitle =
    confirmAction === "promote"
      ? "Promote to Admin?"
      : confirmAction === "resend"
        ? "Resend Admin Invite?"
        : confirmAction === "promote_teacher"
          ? "Promote to Teacher?"
          : confirmAction === "revoke_teacher"
            ? "Revoke Teacher Role?"
            : "Delete User?";
  const confirmDesc =
    confirmAction === "promote"
      ? `This will send a confirmation email to ${confirmUser?.email}. They must click the link to activate their admin role.`
      : confirmAction === "resend"
        ? `This will re-send the admin confirmation email to ${confirmUser?.email}. A new confirmation link will be generated.`
        : confirmAction === "promote_teacher"
          ? `This will send a confirmation email to ${confirmUser?.email}. They must click the link to activate their teacher role and gain access to "My Classes".`
          : confirmAction === "revoke_teacher"
            ? `This will remove the teacher role from ${confirmUser?.email}. Their existing classes are preserved but they will lose access to author new ones.`
            : `This will permanently delete ${confirmUser?.email} and remove related app data. This cannot be undone.`;
  const confirmButton =
    confirmAction === "promote"
      ? "Send Confirmation"
      : confirmAction === "resend"
        ? "Resend Invite"
        : confirmAction === "promote_teacher"
          ? "Send Teacher Invite"
          : confirmAction === "revoke_teacher"
            ? "Revoke Teacher"
            : "Delete User";

  return (
    <div className="container-app py-8 sm:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Admin</h1>
        <p className="text-muted-foreground mt-1">
          Manage user roles for registered Tech Fleet members.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or Discord…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search users"
          />
        </div>
        <Badge variant="secondary" className="text-xs">
          {users.length} users
        </Badge>
        <Badge
          variant="outline"
          className="text-xs"
          aria-label="Accessibility training completion percentage"
        >
          A11y trained: {users.length ? Math.round((a11yTrainedIds.size / users.length) * 100) : 0}%
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <ThemedAgGrid<UserRow>
          gridId="user-admin"
          height="500px"
          rowData={filteredUsers}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.user_id}
          pagination
          paginationPageSize={25}
          domLayout="normal"
          showExportCsv
          exportFileName="users"
        />
      )}

      <AlertDialog open={!!confirmUser} onOpenChange={() => setConfirmUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!promoting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmUser) return;
                if (confirmAction === "promote") handlePromote(confirmUser);
                else if (confirmAction === "resend") handleResendInvite(confirmUser);
                else if (confirmAction === "promote_teacher") handlePromoteTeacher(confirmUser);
                else if (confirmAction === "revoke_teacher") handleRevokeTeacher(confirmUser);
                else handleDeleteUser(confirmUser);
              }}
              disabled={!!promoting}
            >
              {promoting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {confirmButton}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UserDetailDialog user={viewUser} onClose={() => setViewUser(null)} />

      <StepUpMfaDialog
        open={!!stepUp}
        actionLabel={stepUp?.actionLabel}
        onSuccess={() => {
          stepUp?.resolve(true);
          setStepUp(null);
        }}
        onCancel={() => {
          stepUp?.resolve(false);
          setStepUp(null);
        }}
      />
    </div>
  );
}
