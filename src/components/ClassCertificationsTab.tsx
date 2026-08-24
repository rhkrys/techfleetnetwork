import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/design-system";

import {
  RefreshCw,
  Search,
  FileDown,
  MailQuestion,
  MessageSquarePlus,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";
import { generateCertificatePdf } from "@/lib/generate-certificate-pdf";
import { extractClassTitleFallback } from "@/lib/cert-title-utils";
import { useNavigate } from "react-router-dom";

/** Fetch the user's profile name */
function useProfileName(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile-name", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name, last_name, display_name")
        .eq("user_id", userId!)
        // maybeSingle(): a missing profile must not throw "Row not found" —
        // fall back to an empty label instead of crashing the tab.
        .maybeSingle();
      if (error) throw error;
      if (!data) return "";
      const full = [data.first_name, data.last_name].filter(Boolean).join(" ");
      return full || data.display_name || "";
    },
    enabled: !!userId,
  });
}

interface CertificationRow {
  id: string;
  airtable_record_id: string;
  synced_at: string;
  display_title: string;
  raw_data: Record<string, unknown>;
}

/** Fetch cached certifications from the DB */
function useCertifications(userId: string | undefined) {
  return useQuery({
    queryKey: ["class-certifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_certifications")
        .select("id, airtable_record_id, synced_at, display_title, raw_data")
        .order("synced_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CertificationRow[];
    },
    enabled: !!userId,
  });
}

/** Extract a month + year string from raw_data */
function extractMonthYear(raw: Record<string, unknown>): string {
  const dateFields = ["Created", "Date", "Start Date", "Registration Date", "created_at"];
  for (const f of dateFields) {
    const val = raw[f];
    if (!val) continue;
    const d = new Date(String(val));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }
  return "";
}

interface CertCardProps {
  row: CertificationRow;
  profileName: string;
}

function CertCard({ row, profileName }: CertCardProps) {
  const [generating, setGenerating] = useState(false);
  // Use pre-computed display_title from DB; fall back to client-side extraction for legacy rows
  const className = useMemo(
    () => row.display_title || extractClassTitleFallback(row.raw_data),
    [row.display_title, row.raw_data]
  );
  const monthYear = useMemo(() => extractMonthYear(row.raw_data), [row.raw_data]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      toast.info("Generating certificate…");
      await generateCertificatePdf(profileName || "Tech Fleet Member", className || undefined);
      toast.success("Certificate downloaded!");
    } catch (err) {
      console.error("Certificate generation error:", err);
      toast.error("We couldn't generate your certificate. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className="flex flex-col justify-between h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-snug line-clamp-2">
              {className || "Masterclass"}
            </CardTitle>
            {monthYear && <p className="text-xs text-muted-foreground mt-1">{monthYear}</p>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Button size="sm" className="w-full gap-2" onClick={handleGenerate} disabled={generating}>
          <FileDown className="h-4 w-4" />
          {generating ? "Generating…" : "Get Certificate"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ClassCertificationsTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useCertifications(user?.id);
  const { data: profileName = "" } = useProfileName(user?.id);
  const [syncing, setSyncing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSync = useCallback(async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-class-certifications");
      if (error) throw error;
      if (data?.success) {
        setHasSearched(true);
        if (data.total_found === 0) {
          toast.info("No records found", {
            description: "No masterclass registrations were found for your email address.",
          });
        } else {
          toast.success(`Found ${data.total_found} record(s)`, {
            description: `${data.upserted} synced to your profile.`,
          });
        }
        queryClient.invalidateQueries({ queryKey: ["class-certifications"] });
      } else {
        toast.error("Sync failed", { description: data?.error ?? "Unknown error" });
      }
    } catch (err) {
      console.error("Certification sync error:", err);
      toast.error("Could not sync certifications", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSyncing(false);
    }
  }, [user, queryClient]);

  const hasRecords = rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Class Certifications</h2>
          <p className="text-sm text-muted-foreground">
            Historical masterclass records linked to your email address.
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncing}
          className="gap-2"
          variant={hasRecords ? "outline" : "default"}
        >
          {syncing ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {syncing ? "Searching…" : hasRecords ? "Refresh Records" : "Search My Records"}
        </Button>
      </div>

      {isLoading ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground text-sm">Loading certifications…</p>
        </div>
      ) : !hasRecords && hasSearched ? (
        <div className="card-elevated p-12 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MailQuestion className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">No Records Found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              We couldn't find any masterclass registrations linked to your email address. This may
              happen if you registered with a different email, or if your records haven't been added
              to the system yet.
            </p>
          </div>
          <div className="pt-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              Think this is an error? Submit a support ticket and we'll look into it.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => navigate("/feedback")}
            >
              <MessageSquarePlus className="h-4 w-4" />
              Submit a Support Ticket
            </Button>
          </div>
        </div>
      ) : !hasRecords ? (
        <div className="card-elevated p-12 text-center space-y-3">
          <Search className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <p className="text-muted-foreground">
            Click <strong>"Search My Records"</strong> to look up your historical masterclass
            registrations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((row) => (
            <CertCard key={row.id} row={row} profileName={profileName} />
          ))}
        </div>
      )}
    </div>
  );
}
