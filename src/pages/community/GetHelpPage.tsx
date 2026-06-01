import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { sanitizeHtml } from "@/lib/security";
import { toast } from "sonner";
import AdminAllTicketsGrid from "./AdminAllTicketsGrid";
import MonthlyReportPanel from "./MonthlyReportPanel";

interface Conversation {
  id: number;
  number?: number;
  subject?: string;
  status?: string;
  customer?: { id: number; email?: string; firstName?: string; lastName?: string };
  threads?: Array<{ id: number; type?: string; body?: string; createdAt?: string; createdBy?: any }>;
  createdAt?: string;
  updatedAt?: string;
}

function formatStatus(s?: string): { label: string; tone: "default" | "secondary" | "outline" } {
  if (s === "active" || s === "open") return { label: "Open", tone: "default" };
  if (s === "closed") return { label: "Closed", tone: "secondary" };
  if (s === "pending") return { label: "Pending", tone: "outline" };
  return { label: s ?? "Unknown", tone: "outline" };
}

interface TicketsResponse {
  items: Conversation[];
  unavailable: boolean;
  reason?: string;
}

const SUPPORT_FALLBACK_EMAIL = "info@techfleet.network";

async function readFunctionError(response?: Response): Promise<{ unavailable?: boolean; reason?: string } | null> {
  if (!response) return null;
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

/**
 * Wrap supabase.functions.invoke so the user's access token is ALWAYS attached.
 * The default invoke can race with auth-state hydration on first paint and send
 * the request without an Authorization header, which the edge function rejects
 * as `missing_token`.
 */
async function invokeFreescout<T = any>(body: Record<string, unknown>, signal?: AbortSignal) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  return supabase.functions.invoke<T>("freescout-proxy", {
    body,
    signal,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  } as any);
}

function useTickets(scope: "mine" | "all", status: "open" | "closed" | "all") {
  return useQuery<TicketsResponse>({
    queryKey: ["support", "tickets", scope, status] as const,
    queryFn: async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const { data, error } = await invokeFreescout(
          { action: scope === "mine" ? "listMine" : "listAll", status, page: 1 },
          ctrl.signal,
        );
        if (error) {
          return { items: [], unavailable: true, reason: error.message ?? "invoke_failed" };
        }
        return {
          items: (data?.items ?? []) as Conversation[],
          unavailable: data?.unavailable === true,
          reason: data?.reason,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    staleTime: 30_000,
    retry: 1,
  });
}

function NewTicketDialog({ onCreated, disabled = false }: { onCreated: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [helpDeskOffline, setHelpDeskOffline] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 3 || body.trim().length < 1) {
      toast.error("Add a subject and a short message.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error, response } = await invokeFreescout({
        action: "create",
        subject: subject.trim().slice(0, 200),
        body: body.trim().slice(0, 10000),
        idempotencyKey: `create-${crypto.randomUUID()}`,
      }) as any;
      const errorBody = await readFunctionError(response);
      if (data?.unavailable || response?.status === 503 || errorBody?.unavailable || (error && /unavailable/i.test(error.message ?? ""))) {
        setHelpDeskOffline(true);
        toast.error("Help desk is offline. An admin has been notified.");
        return;
      }
      if (error || !data?.conversationId) throw error ?? new Error("Could not create ticket");
      toast.success("Ticket created. Our team will reply soon.");
      setOpen(false);
      setSubject("");
      setBody("");
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create your ticket. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Create ticket</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>Share what you need help with and our team will reply by email and in this view.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="Short summary of your question"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-body">Details</Label>
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              rows={6}
              placeholder="Tell us what's happening, what you tried, and what you expected."
            />
            <p className="text-sm text-muted-foreground">{body.length}/10,000</p>
          </div>
          {helpDeskOffline && (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm text-muted-foreground">
                <span>Help desk is offline. Email us while an admin reconnects it.</span>
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${SUPPORT_FALLBACK_EMAIL}?subject=${encodeURIComponent(subject.trim() || "Tech Fleet Network support request")}`}>
                    Email {SUPPORT_FALLBACK_EMAIL}
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send ticket"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketDetail({ conversationId, onClose }: { conversationId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const { data: conv, isLoading } = useQuery({
    queryKey: ["support", "ticket", conversationId] as const,
    queryFn: async () => {
      const { data, error } = await invokeFreescout({ action: "get", conversationId });
      if (error) throw error;
      return data?.conversation as Conversation;
    },
    staleTime: 15_000,
  });

  const closeMut = useMutation({
    mutationFn: async (action: "close" | "reopen") => {
      const { error } = await supabase.functions.invoke("freescout-proxy", {
        body: { action, conversationId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ticket updated.");
      qc.invalidateQueries({ queryKey: ["support"] as const });
    },
    onError: () => toast.error("Could not update the ticket."),
  });

  const sendReply = async () => {
    if (reply.trim().length < 1) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("freescout-proxy", {
        body: { action: "reply", conversationId, body: reply.trim().slice(0, 10000), idempotencyKey: `reply-${crypto.randomUUID()}` },
      });
      if (error) throw error;
      setReply("");
      toast.success("Reply sent.");
      qc.invalidateQueries({ queryKey: ["support", "ticket", conversationId] as const });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send your reply.");
    } finally {
      setSending(false);
    }
  };

  const threads = useMemo(() => (conv?.threads ?? []).slice().reverse(), [conv]);
  const status = formatStatus(conv?.status);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{conv?.subject ?? `Ticket #${conversationId}`}</DialogTitle>
          <DialogDescription>
            <Badge variant={status.tone}>{status.label}</Badge>
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="space-y-3">
          {threads.map((t) => (
            <Card key={t.id} data-no-card={false}>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-normal">
                  {t.type === "customer" ? "You" : "Tech Fleet"}
                </CardTitle>
                {t.createdAt && (
                  <CardDescription>{new Date(t.createdAt).toLocaleString()}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.body ?? "") }}
                />
              </CardContent>
            </Card>
          ))}
        </div>
        {conv?.status !== "closed" && (
          <div className="space-y-2 pt-2">
            <Label htmlFor="ticket-reply">Reply</Label>
            <Textarea
              id="ticket-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={10000}
              rows={4}
            />
          </div>
        )}
        <DialogFooter className="gap-2">
          {conv?.status === "closed" ? (
            <Button variant="outline" onClick={() => closeMut.mutate("reopen")}>Reopen ticket</Button>
          ) : (
            <Button variant="outline" onClick={() => closeMut.mutate("close")}>Close ticket</Button>
          )}
          {conv?.status !== "closed" && (
            <Button onClick={sendReply} disabled={sending || reply.trim().length < 1}>
              {sending ? "Sending…" : "Send reply"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketList({ scope }: { scope: "mine" | "all" }) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [activeId, setActiveId] = useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useTickets(scope, status);
  const tickets = data?.items ?? [];
  const unavailable = data?.unavailable === true || isError;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {scope === "mine" && <NewTicketDialog onCreated={() => refetch()} disabled={unavailable} />}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading tickets…</p>}

      {!isLoading && unavailable && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Help desk is reconnecting</CardTitle>
            <CardDescription>
              We can't reach our support system right now. An admin has been notified. In the meantime, you can still reach us by email.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={`mailto:${SUPPORT_FALLBACK_EMAIL}?subject=${encodeURIComponent("Tech Fleet Network support request")}`}>
                Email {SUPPORT_FALLBACK_EMAIL}
              </a>
            </Button>
            <Button variant="outline" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !unavailable && tickets.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No tickets to show.</p>
            {scope === "mine" && <p className="mt-2 text-sm">Create your first ticket above when you need a hand.</p>}
          </CardContent>
        </Card>
      )}

      {!unavailable && (
        <div className="grid gap-3">
          {tickets.map((t) => {
            const s = formatStatus(t.status);
            return (
              <Card key={t.id} className="cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => setActiveId(t.id)}>
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base font-medium">{t.subject ?? `Ticket #${t.number ?? t.id}`}</CardTitle>
                    <Badge variant={s.tone}>{s.label}</Badge>
                  </div>
                  {t.updatedAt && (
                    <CardDescription>Updated {new Date(t.updatedAt).toLocaleString()}</CardDescription>
                  )}
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {activeId !== null && <TicketDetail conversationId={activeId} onClose={() => setActiveId(null)} />}
    </div>
  );
}

export default function GetHelpPage() {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const qc = useQueryClient();

  // Realtime: invalidate ticket lists on webhook-driven events
  useEffect(() => {
    if (!user) return;
    const userChannel = supabase
      .channel(`support:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_ticket_events" }, () => {
        qc.invalidateQueries({ queryKey: ["support"] as const });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_ticket_pointers" }, () => {
        qc.invalidateQueries({ queryKey: ["support"] as const });
      })
      .subscribe();
    return () => { supabase.removeChannel(userChannel); };
  }, [user, qc]);

  if (!user) return null;


  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-display font-semibold">Get Help</h1>
        <p className="text-muted-foreground">Reach our support team and track every ticket you open.</p>
      </header>

      {isAdmin ? (
        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">My tickets</TabsTrigger>
            <TabsTrigger value="all">All tickets</TabsTrigger>
            <TabsTrigger value="grid">Triage grid</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="mt-6"><TicketList scope="mine" /></TabsContent>
          <TabsContent value="all" className="mt-6"><TicketList scope="all" /></TabsContent>
          <TabsContent value="grid" className="mt-6"><AdminAllTicketsGrid /></TabsContent>
          <TabsContent value="reports" className="mt-6"><MonthlyReportPanel /></TabsContent>
        </Tabs>

      ) : (
        <TicketList scope="mine" />
      )}
    </div>
  );
}
