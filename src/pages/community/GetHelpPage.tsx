import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@/lib/react-query";
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
import { toast } from "sonner";
import AdminAllTicketsGrid from "./AdminAllTicketsGrid";
import MonthlyReportPanel from "./MonthlyReportPanel";
import TicketDetail, { formatStatus, type Conversation } from "./TicketDetail";
import { invokeFreescout } from "@/lib/support/freescoutInvoke";

function useTickets(scope: "mine" | "all", status: "open" | "closed" | "all") {
  return useQuery<{ items: Conversation[] }>({
    queryKey: ["support", "tickets", scope, status] as const,
    queryFn: async () => {
      const { data, error } = await invokeFreescout(
        { action: scope === "mine" ? "listMine" : "listAll", status, page: 1 },
      );
      if (error) throw error;
      return { items: (data?.items ?? []) as Conversation[] };
    },
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });
}

function NewTicketDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 3 || body.trim().length < 1) {
      toast.error("Add a subject and a short message.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await invokeFreescout({
        action: "create",
        subject: subject.trim().slice(0, 200),
        body: body.trim().slice(0, 10000),
        idempotencyKey: `create-${crypto.randomUUID()}`,
      });
      if (error || !data?.conversationId) throw error ?? new Error("Could not create ticket");
      toast.success("Ticket created. Our team will reply soon.");
      setOpen(false);
      setSubject("");
      setBody("");
      onCreated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || "Could not create your ticket. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create ticket</Button>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Sending…" : "Send ticket"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketList({ scope }: { scope: "mine" | "all" }) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [activeId, setActiveId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, isError } = useTickets(scope, status);
  const tickets = data?.items ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["support"] as const });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={status} onValueChange={(v) => setStatus(v as "open" | "closed" | "all")}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {scope === "mine" && <NewTicketDialog onCreated={refresh} />}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading tickets…</p>}

      {!isLoading && isError && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">We couldn't load your tickets.</CardTitle>
            <CardDescription>Please try again in a moment.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={refresh}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && tickets.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No tickets to show.</p>
            {scope === "mine" && <p className="mt-2 text-sm">Create your first ticket above when you need a hand.</p>}
          </CardContent>
        </Card>
      )}

      {!isError && (
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
            <TabsTrigger value="open-unassigned">Open · unassigned</TabsTrigger>
            <TabsTrigger value="open-assigned">Open · assigned</TabsTrigger>
            <TabsTrigger value="all">All tickets</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="mt-6"><TicketList scope="mine" /></TabsContent>
          <TabsContent value="open-unassigned" className="mt-6"><AdminAllTicketsGrid scope="open-unassigned" /></TabsContent>
          <TabsContent value="open-assigned" className="mt-6"><AdminAllTicketsGrid scope="open-assigned" /></TabsContent>
          <TabsContent value="all" className="mt-6"><AdminAllTicketsGrid scope="all" /></TabsContent>
          <TabsContent value="reports" className="mt-6"><MonthlyReportPanel /></TabsContent>
        </Tabs>
      ) : (
        <TicketList scope="mine" />
      )}
    </div>
  );
}
