import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/contexts/AuthContext";
import { FeedbackService } from "@/services/feedback.service";
import { SEO } from "@/components/SEO";
import { toast } from "sonner";
import { usePolicy } from "@/hooks/usePolicy";

export default function AccessibilityPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { pathname } = useLocation();
  const [page, setPage] = useState("");
  const [barrier, setBarrier] = useState("");
  const [tech, setTech] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: policy } = usePolicy("accessibility");
  const policyMd = policy?.body_md ?? "";

  useEffect(() => {
    setPage(typeof window !== "undefined" ? window.location.href : pathname);
    setEmail(profile?.email || user?.email || "");
  }, [pathname, profile?.email, user?.email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barrier.trim()) return;
    setBusy(true);
    const message = [
      `Page: ${page}`,
      `Assistive tech: ${tech || "—"}`,
      `Barrier: ${barrier}`,
    ].join("\n");
    const ok = await FeedbackService.submit(
      user?.id ?? "00000000-0000-0000-0000-000000000000",
      email || "info@techfleet.network",
      "Accessibility",
      message,
    );
    setBusy(false);
    if (ok) {
      toast.success(t("accessibility.submitted"));
      setBarrier("");
      setTech("");
    } else {
      toast.error(t("errors.generic"));
    }
  };

  return (
    <div className="container-app py-8 space-y-8">
      <SEO
        title="Accessibility Policy"
        description="Tech Fleet's commitment to digital accessibility. Read our policy and request accommodations."
        canonicalPath="/accessibility"
      />
      <header>
        <h1 className="text-2xl font-bold">{t("accessibility.policyTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("accessibility.contact")}</p>
      </header>

      <section aria-labelledby="report-barrier" className="rounded-md border bg-card p-4 sm:p-6">
        <h2 id="report-barrier" className="text-lg font-semibold">
          {t("accessibility.reportBarrierTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{t("accessibility.reportBarrierIntro")}</p>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <div className="field-group">
            <Label htmlFor="a11y-page">{t("accessibility.fields.page")}</Label>
            <Input id="a11y-page" value={page} onChange={(e) => setPage(e.target.value)} />
          </div>
          <div className="field-group">
            <Label htmlFor="a11y-barrier">{t("accessibility.fields.barrier")}</Label>
            <Textarea
              id="a11y-barrier"
              required
              value={barrier}
              onChange={(e) => setBarrier(e.target.value)}
              rows={5}
              maxLength={5000}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field-group">
              <Label htmlFor="a11y-tech">{t("accessibility.fields.assistiveTech")}</Label>
              <Input id="a11y-tech" value={tech} onChange={(e) => setTech(e.target.value)} />
            </div>
            <div className="field-group">
              <Label htmlFor="a11y-email">{t("accessibility.fields.contactEmail")}</Label>
              <Input id="a11y-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? t("actions.loading") : t("actions.submit")}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="policy-text" className="prose prose-sm dark:prose-invert max-w-none">
        <h2 id="policy-text" className="sr-only">{t("accessibility.policyTitle")}</h2>
        <ReactMarkdown>{policyMd}</ReactMarkdown>
      </section>
    </div>
  );
}
