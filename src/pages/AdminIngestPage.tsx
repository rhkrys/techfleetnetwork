import { useState } from "react";
import { Button } from "@/design-system";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { WorkshopDocsUploader } from "@/components/admin/WorkshopDocsUploader";

// CSVs now live in the private `framework-source-csv` storage bucket. The
// admin browser never fetches /data/*.csv directly — the `framework-csv-fetch`
// edge function validates JWT + admin role, downloads via service role, and
// returns the text + SHA-256 checksum for provenance logging.
const CSV_DATASETS = [
  { file: "job-industries.csv", name: "Job Industries" },
  { file: "company-types.csv", name: "Company Types" },
  { file: "tools.csv", name: "Tools" },
  { file: "agile-methods.csv", name: "Agile Methods" },
  { file: "job-specializations.csv", name: "Job Specializations" },
  { file: "milestones.csv", name: "Milestones" },
  { file: "deliverables.csv", name: "Deliverables" },
  { file: "deliverables-2.csv", name: "Deliverables (Extended)" },
  { file: "skills-framework.csv", name: "Skills Framework Data Types" },
  { file: "tech-job-categories.csv", name: "Tech Job Categories" },
  { file: "team-functions.csv", name: "Team Functions" },
  { file: "duties.csv", name: "Duties" },
  { file: "activities.csv", name: "Activities" },
  { file: "practices.csv", name: "Practices" },
  { file: "skills.csv", name: "Skills" },
  { file: "workshops-detailed.csv", name: "Workshops (Detailed)" },
  { file: "handbooks-detailed.csv", name: "Handbooks (Detailed)" },
];

async function fetchCsvFromBucket(
  filename: string
): Promise<{ csv_text: string; checksum: string }> {
  const { data, error } = await supabase.functions.invoke("framework-csv-fetch", {
    body: { filename },
  });
  if (error) throw new Error(error.message);
  if (!data?.csv_text) throw new Error("Empty CSV payload");
  return { csv_text: data.csv_text as string, checksum: data.checksum as string };
}

type Status = "idle" | "loading" | "done" | "error";

export default function AdminIngestPage() {
  const [statuses, setStatuses] = useState<Record<string, { status: Status; detail?: string }>>(
    Object.fromEntries(CSV_DATASETS.map((d) => [d.name, { status: "idle" as Status }]))
  );
  const [running, setRunning] = useState(false);

  const ingestOne = async (file: string, name: string) => {
    setStatuses((prev) => ({ ...prev, [name]: { status: "loading" } }));
    try {
      const { csv_text } = await fetchCsvFromBucket(file);

      const { data, error } = await supabase.functions.invoke("ingest-csv-knowledge", {
        body: { csv_text, dataset_name: name },
      });

      if (error) throw new Error(error.message);
      setStatuses((prev) => ({
        ...prev,
        [name]: { status: "done", detail: `${data.inserted} entries inserted` },
      }));
    } catch (err: any) {
      setStatuses((prev) => ({
        ...prev,
        [name]: { status: "error", detail: err.message },
      }));
    }
  };

  const ingestAll = async () => {
    setRunning(true);
    for (const ds of CSV_DATASETS) {
      await ingestOne(ds.file, ds.name);
    }
    setRunning(false);
    toast.success("All datasets processed!");
  };

  // ---- Reference table sync (structured DB) ----
  const [refStatuses, setRefStatuses] = useState<
    Record<string, { status: Status; detail?: string }>
  >(Object.fromEntries(CSV_DATASETS.map((d) => [d.name, { status: "idle" as Status }])));
  const [refRunning, setRefRunning] = useState(false);

  const syncReferenceOne = async (file: string, name: string) => {
    setRefStatuses((prev) => ({ ...prev, [name]: { status: "loading" } }));
    try {
      const { csv_text, checksum } = await fetchCsvFromBucket(file);
      const { data, error } = await supabase.functions.invoke("ingest-reference-csv", {
        body: {
          csv_text,
          dataset_name: name,
          source_filename: file,
          source_checksum: checksum,
        },
      });
      if (error) throw new Error(error.message);
      const parts = [`${data.upserted} rows → ${data.table}`];
      if (typeof data.edges_inserted === "number") parts.push(`${data.edges_inserted} edges`);
      if (typeof data.replay_resolved === "number" && data.replay_resolved > 0)
        parts.push(`+${data.replay_resolved} promoted`);
      if (typeof data.staging_remaining === "number" && data.staging_remaining > 0)
        parts.push(`${data.staging_remaining} unresolved`);
      setRefStatuses((prev) => ({
        ...prev,
        [name]: { status: "done", detail: parts.join(" • ") },
      }));
    } catch (err: any) {
      setRefStatuses((prev) => ({
        ...prev,
        [name]: { status: "error", detail: err.message },
      }));
    }
  };

  const syncReferenceAll = async () => {
    setRefRunning(true);
    for (const ds of CSV_DATASETS) {
      await syncReferenceOne(ds.file, ds.name);
    }
    setRefRunning(false);
    toast.success("Reference tables synced");
  };

  return (
    <div className="container-app py-8 max-w-2xl space-y-10">
      <header>
        <h1 className="text-2xl font-bold mb-2">Knowledge Base Ingestion</h1>
        <p className="text-muted-foreground">
          Load Tech Fleet reference content into Fleety's knowledge base.
        </p>
      </header>

      <WorkshopDocsUploader />

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">CSV Reference Data</h2>
          <p className="text-sm text-muted-foreground">
            Load team practices CSV data into the Fleety knowledge base.
          </p>
        </div>

        <Button onClick={ingestAll} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              Ingesting...
            </>
          ) : (
            "Ingest All Datasets"
          )}
        </Button>

        <div className="space-y-2">
          {CSV_DATASETS.map((ds) => {
            const st = statuses[ds.name];
            return (
              <div key={ds.name} className="flex items-center gap-3 p-3 border rounded-lg">
                {st.status === "idle" && (
                  <div
                    className="h-5 w-5 rounded-full border-2 border-muted-foreground/30"
                    aria-hidden="true"
                  />
                )}
                {st.status === "loading" && (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                )}
                {st.status === "done" && (
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                )}
                {st.status === "error" && (
                  <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium">{ds.name}</p>
                  {st.detail && <p className="text-xs text-muted-foreground">{st.detail}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => ingestOne(ds.file, ds.name)}
                  disabled={running || st.status === "loading"}
                >
                  Ingest
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Reference Tables (Structured DB)</h2>
          <p className="text-sm text-muted-foreground">
            Load the same CSVs into normalized <code>reference_*</code> tables for fast in-app
            lookup (skills picker, milestones, activities, etc.). Idempotent — safe to re-run.
          </p>
        </div>

        <Button onClick={syncReferenceAll} disabled={refRunning}>
          {refRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              Syncing...
            </>
          ) : (
            "Sync All Reference Tables"
          )}
        </Button>

        <div className="space-y-2">
          {CSV_DATASETS.map((ds) => {
            const st = refStatuses[ds.name];
            return (
              <div key={`ref-${ds.name}`} className="flex items-center gap-3 p-3 border rounded-lg">
                {st.status === "idle" && (
                  <div
                    className="h-5 w-5 rounded-full border-2 border-muted-foreground/30"
                    aria-hidden="true"
                  />
                )}
                {st.status === "loading" && (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                )}
                {st.status === "done" && (
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                )}
                {st.status === "error" && (
                  <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium">{ds.name}</p>
                  {st.detail && <p className="text-xs text-muted-foreground">{st.detail}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncReferenceOne(ds.file, ds.name)}
                  disabled={refRunning || st.status === "loading"}
                >
                  Sync
                </Button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
