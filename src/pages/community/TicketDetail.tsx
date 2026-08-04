import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/lib/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { sanitizeHtml } from "@/lib/security";
import { toast } from "sonner";
import { invokeFreescout } from "@/lib/support/freescoutInvoke";

export interface Conversation {
  id: number;
  number?: number;
  subject?: string;
  status?: string;
  customer?: { id: number; email?: string; firstName?: string; lastName?: string };
  threads?: Array<{ id: number; type?: string; body?: string; createdAt?: string; createdBy?: unknown }>;
  createdAt?: string;
  updatedAt?: string;
}

export function formatStatus(s?: string): { label: string; tone: "default" | "secondary" | "outline" } {
  if (s === "active" || s === "open") return { label: "Open", tone: "default" };
  if (s === "closed") return { label: "Closed", tone: "secondary" };
  if (s === "pending") return { label: "Pending", tone: "outline" };
  return { label: s ?? "Unknown", tone: "outline" };
}

/**
 * Ticket thread + reply dialog. Shared by the member view (Get Help) and the
 * admin triage grid so an admin can actually READ a conversation they are
 * triaging (previously the grid had no way to open the thread).
 *
 * `viewerRole` only affects author labels: a member sees their own messages as
 * "You"; an admin sees them as "Customer" (the admin is not the customer).
 * Reply/close authorization is enforced server-side by freescout-proxy
 * (admin OR owner), not by this prop.
 */
export default function TicketDetail({
  conversationId,
  onClose,
  viewerRole = "member",
}: {
  conversationId: number;
  onClose: () => void;
  viewerRole?: "member" | "admin";
}) {
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
      const { error } = await invokeFreescout({ action, conversationId });
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
      const { error } = await invokeFreescout({
        action: "reply", conversationId, body: reply.trim().slice(0, 10000), idempotencyKey: `reply-${crypto.randomUUID()}`,
      });
      if (error) throw error;
      setReply("");
      toast.success("Reply sent.");
      qc.invalidateQueries({ queryKey: ["support"] as const });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || "Could not send your reply.");
    } finally {
      setSending(false);
    }
  };

  const threads = useMemo(() => (conv?.threads ?? []).slice().reverse(), [conv]);
  const status = formatStatus(conv?.status);
  const customerLabel = viewerRole === "admin" ? "Customer" : "You";

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
            <Card key={t.id}>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-normal">
                  {t.type === "customer" ? customerLabel : "Tech Fleet"}
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
