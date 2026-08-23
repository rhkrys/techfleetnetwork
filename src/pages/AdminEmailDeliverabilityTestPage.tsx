import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { PageTitle } from "@/components/ui/typography";
import { CheckCircle2, Loader2, AlertTriangle, Send } from "lucide-react";

/**
 * Admin-only deliverability smoke harness. Enqueues a representative send for
 * every registered transactional template against an admin-supplied mailbox.
 * Each row reports back queue status; admin then inspects Gmail "Show Original"
 * to verify SPF/DKIM/DMARC PASS, List-Unsubscribe header, plaintext alternative.
 */
export const TEMPLATES: { name: string; label: string; sample?: Record<string, unknown> }[] = [
  {
    name: "applicant-status-change",
    label: "Applicant status change",
    sample: { applicantName: "Test", projectTitle: "Demo Project", newStatus: "Interview" },
  },
  {
    name: "interview-invite",
    label: "Interview invite",
    sample: {
      applicantName: "Test",
      projectTitle: "Demo Project",
      interviewerName: "Coach",
      schedulingLink: "https://techfleet.network",
    },
  },
  {
    name: "community-agreement-request",
    label: "Community agreement request",
    sample: { memberName: "Test" },
  },
  {
    name: "signup-confirmation-reminder",
    label: "Signup confirmation reminder",
    sample: { firstName: "Test" },
  },
  { name: "observer-role-granted", label: "Observer role granted", sample: { memberName: "Test" } },
  {
    name: "fleety-coach-digest",
    label: "Fleety weekly digest (bulk)",
    sample: { memberName: "Test", insights: [] },
  },
  {
    name: "quest-nudge",
    label: "Quest nudge",
    sample: { memberName: "Test", questTitle: "UX Research Quest" },
  },
  {
    name: "project-blast",
    label: "Project blast (bulk)",
    sample: { subject: "Project update", projectTitle: "Demo", bodyHtml: "<p>Hello.</p>" },
  },
  {
    name: "admin-member-alert",
    label: "Admin member alert",
    sample: { memberName: "Test", alertReason: "Smoke test" },
  },
];

type Result = {
  template: string;
  status: "pending" | "ok" | "error";
  message?: string;
  messageId?: string;
};

export default function AdminEmailDeliverabilityTestPage() {
  const { setHeader } = usePageHeader();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    setHeader({
      title: "Email deliverability test",
      description: "Send one of each template to verify inbox placement",
      breadcrumbs: [{ label: "Admin" }, { label: "Email deliverability test" }],
    });
    return () => setHeader(null);
  }, [setHeader]);

  const run = async () => {
    if (!email || !/.+@.+\..+/.test(email)) {
      toast({
        variant: "destructive",
        title: "Enter a valid email",
        description: "Provide a test mailbox to send to.",
      });
      return;
    }
    setRunning(true);
    const initial: Result[] = TEMPLATES.map((t) => ({ template: t.name, status: "pending" }));
    setResults(initial);

    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      try {
        const { data, error } = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: t.name,
            recipientEmail: email,
            idempotencyKey: `deliv-test-${t.name}-${Date.now()}`,
            templateData: t.sample ?? {},
          },
        });
        if (error) throw error;
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "ok", messageId: (data as any)?.messageId } : r
          )
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: "error", message: err instanceof Error ? err.message : String(err) }
              : r
          )
        );
      }
    }

    setRunning(false);
    toast({
      title: "Test send complete",
      description:
        "Open Gmail → Show Original on each email to verify SPF, DKIM, DMARC, and List-Unsubscribe.",
    });
  };

  return (
    <section className="container-app py-8 space-y-6" aria-labelledby="deliv-test-heading">
      <PageTitle id="deliv-test-heading">Email deliverability test</PageTitle>
      <Card>
        <CardHeader>
          <CardTitle>Run full deliverability test</CardTitle>
          <CardDescription>
            Sends one of each registered transactional template to a mailbox you control. Then in
            Gmail click the three-dot menu &rarr; "Show original" to confirm SPF / DKIM / DMARC all
            PASS, List-Unsubscribe header is present, and plaintext alternative exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-md">
            <Label htmlFor="test-email">Send test emails to</Label>
            <Input
              id="test-email"
              type="email"
              placeholder="you@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={running}
            />
          </div>
          <Button onClick={run} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {running ? "Sending..." : "Send test emails"}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              Queue acknowledgement per template. Inspect actual headers in the recipient inbox.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y" role="list">
              {results.map((r) => (
                <li
                  key={r.template}
                  className="flex items-center justify-between gap-2 py-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {r.status === "pending" && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {r.status === "ok" && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {r.status === "error" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    <span className="font-medium">{r.template}</span>
                    {r.messageId && (
                      <span className="text-xs text-muted-foreground">
                        {r.messageId.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  <Badge
                    variant={
                      r.status === "ok"
                        ? "secondary"
                        : r.status === "error"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {r.status === "pending" ? "Queueing" : r.status === "ok" ? "Queued" : "Failed"}
                  </Badge>
                </li>
              ))}
            </ul>
            {results.some((r) => r.status === "error") && (
              <p className="mt-3 text-xs text-destructive">
                {results.find((r) => r.status === "error")?.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
