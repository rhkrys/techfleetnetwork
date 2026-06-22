/**
 * withBoundedSave — wraps a Supabase mutation in a hard client timeout and a
 * resolve-indeterminate probe so a hung PostgREST connection (the
 * "spinner forever, no error" failure mode) can never strand the UI.
 *
 * Usage:
 *   await withBoundedSave({
 *     timeoutMs: 15_000,
 *     save: async () => {
 *       const { error } = await supabase.from("projects").update(values).eq("id", id);
 *       if (error) throw error;
 *     },
 *     probe: async () => {
 *       const { data } = await supabase.from("projects")
 *         .select("id, updated_at, name").eq("id", id).maybeSingle();
 *       return data && data.name === values.name ? "persisted" : "unresolved";
 *     },
 *     onStatus: (s) => setStatus(s),  // "saving" | "checking" | "saved" | "failed"
 *     beacon: (outcome, details) => emitOpsBeacon(...),
 *   });
 *
 * Returns a discriminated union — never throws on the indeterminate-resolved
 * "persisted" branch (treated as success). Throws SaveIndeterminateError on
 * "unresolved" so the caller can show a Retry CTA.
 */
export class SaveIndeterminateError extends Error {
  readonly code = "save_indeterminate" as const;
  constructor(message = "We couldn't confirm the save. Please try again.") {
    super(message);
    this.name = "SaveIndeterminateError";
  }
}

export type BoundedSaveStatus = "saving" | "checking" | "saved" | "failed";

export type BoundedSaveOutcome =
  | { kind: "saved" }
  | { kind: "indeterminate_resolved"; resolution: "persisted" }
  | { kind: "indeterminate_unresolved" };

export interface BoundedSaveOptions {
  timeoutMs?: number;
  save: () => Promise<void>;
  /** Returns "persisted" when DB row matches expected state, else "unresolved". */
  probe: () => Promise<"persisted" | "unresolved">;
  onStatus?: (status: BoundedSaveStatus) => void;
  beacon?: (
    outcome:
      | "saved"
      | "indeterminate_persisted"
      | "indeterminate_unresolved"
      | "error",
    details?: Record<string, unknown>,
  ) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const TIMEOUT = Symbol("bounded_save_timeout");

export async function withBoundedSave(
  opts: BoundedSaveOptions,
): Promise<BoundedSaveOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  opts.onStatus?.("saving");

  const timer = new Promise<typeof TIMEOUT>((resolve) =>
    setTimeout(() => resolve(TIMEOUT), timeoutMs),
  );

  try {
    const race = await Promise.race([opts.save().then(() => "ok" as const), timer]);

    if (race === "ok") {
      opts.onStatus?.("saved");
      opts.beacon?.("saved");
      return { kind: "saved" };
    }

    // Timeout — run the resolve probe before deciding.
    opts.onStatus?.("checking");
    let resolution: "persisted" | "unresolved" = "unresolved";
    try {
      resolution = await opts.probe();
    } catch {
      resolution = "unresolved";
    }

    if (resolution === "persisted") {
      opts.onStatus?.("saved");
      opts.beacon?.("indeterminate_persisted", { timeoutMs });
      return { kind: "indeterminate_resolved", resolution: "persisted" };
    }

    opts.onStatus?.("failed");
    opts.beacon?.("indeterminate_unresolved", { timeoutMs });
    throw new SaveIndeterminateError();
  } catch (err) {
    if (err instanceof SaveIndeterminateError) throw err;
    opts.onStatus?.("failed");
    opts.beacon?.("error", { message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
