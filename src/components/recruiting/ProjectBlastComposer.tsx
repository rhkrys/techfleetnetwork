import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "@/hooks/use-toast";
import { Loader2, Send, Users } from "lucide-react";
import { useServerDraft } from "@/hooks/use-server-draft";
import { DraftRestoredBanner } from "@/components/forms/DraftRestoredBanner";

const SUBJECT_MAX = 150;
const BODY_MAX = 50_000;

interface Props {
  projectId: string;
  projectName: string;
  canSend?: boolean;
}

export default function ProjectBlastComposer({ projectId, projectName, canSend: canSendProp = true }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const draft = useServerDraft<{ subject: string; body: string }>({
    draftKey: `project-blast:${projectId}`,
    schemaVersion: 1,
    initialValue: { subject: "", body: "" },
    enabled: canSendProp,
    label: "project-blast",
  });
  const subject = draft.value.subject;
  const body = draft.value.body;
  const setSubject = (v: string) => draft.setValue((d) => ({ ...d, subject: v }));
  const setBody = (v: string) => draft.setValue((d) => ({ ...d, body: v }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: applicantCount = 0 } = useQuery({
    queryKey: ["project-blast-applicant-count", projectId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("project_applications")
        .select("id", { head: true, count: "exact" })
        .eq("project_id", projectId)
        .eq("status", "completed");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user && canSendProp,
  });


  const subjectTrim = subject.trim();
  const bodyText = useMemo(() => body.replace(/<[^>]+>/g, "").trim(), [body]);
  const canSend =
    canSendProp &&
    subjectTrim.length > 0 &&
    subjectTrim.length <= SUBJECT_MAX &&
    body.length > 0 &&
    body.length <= BODY_MAX &&
    bodyText.length > 0 &&
    applicantCount > 0 &&
    !sending;

  if (!canSendProp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project blasts</CardTitle>
          <CardDescription>
            Only admins can send project blasts.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function handleSend() {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-project-blast", {
        body: { projectId, subject: subjectTrim, bodyHtml: body },
      });
      // Surface the JSON error body the edge fn returned (e.g. "No applicants to email")
      // instead of the generic "Edge Function returned a non-2xx status code".
      if (error) {
        let serverMsg: string | undefined;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const parsed = await ctx.json();
            serverMsg = parsed?.error || parsed?.detail;
          }
        } catch { /* fall through to generic */ }
        throw new Error(serverMsg || error.message || "Send failed");
      }
      const result = data as { recipientCount: number; emailSent: number; emailFailed: number; status: string };
      toast({
        title: `Blast sent to ${result.recipientCount} ${result.recipientCount === 1 ? "applicant" : "applicants"}`,
        description: `${result.emailSent} delivered · ${result.emailFailed} failed`,
      });
      setSubject("");
      setBody("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["project-blasts-history", projectId] });
    } catch (e: any) {
      toast({
        title: "Couldn't send blast",
        description: e?.message ?? "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Send a project blast
          </CardTitle>
          <CardDescription>
            Sends a branded email and an in-app notification to everyone who applied to this project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>
              This will reach <strong>{applicantCount}</strong>{" "}
              {applicantCount === 1 ? "applicant" : "applicants"} for{" "}
              <strong>{projectName}</strong>.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="blast-subject">Subject line</Label>
            <Input
              id="blast-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
              placeholder="Quick update on this week's milestones"
              maxLength={SUBJECT_MAX}
              aria-describedby="blast-subject-help"
            />
            <p id="blast-subject-help" className="text-xs text-muted-foreground">
              {subjectTrim.length}/{SUBJECT_MAX} characters
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="blast-body">Message</Label>
            <RichTextEditor content={body} onChange={setBody} placeholder="Write your update…" />
            <p className="text-xs text-muted-foreground">
              Scripts and unsafe HTML are stripped automatically.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => { setSubject(""); setBody(""); }}
              disabled={sending || (!subject && !body)}
            >
              Clear draft
            </Button>
            <Button
              disabled={!canSend}
              onClick={() => setConfirmOpen(true)}
            >
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send blast
            </Button>
          </div>
        </CardContent>
      </Card>


      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send blast to ${applicantCount} ${applicantCount === 1 ? "applicant" : "applicants"}?`}
        consequence={
          <>
            Each applicant will receive an email and an in-app notification.
            This action can't be undone.
          </>
        }
        actionLabel="Send blast"
        loading={sending}
        onConfirm={handleSend}
      />
    </div>
  );
}
