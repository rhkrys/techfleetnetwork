// React Query hooks for the Hand-Off Production System. Reads are RLS-scoped; the production
// query self-polls while a run is non-terminal; mutations invalidate the dependent keys.
import { useMutation, useQuery, useQueryClient } from "@/lib/react-query";
import {
  deleteSubmission,
  getCompleteness,
  getLatestProduction,
  getRunBudget,
  type HandoffAudience,
  type HandoffLinkType,
  type HandoffProduction,
  type HandoffRating,
  isTerminalStatus,
  listFeedback,
  listOutputs,
  listSubmissions,
  produceHandoffs,
  submitFeedback,
  submitFile,
  submitLink,
  submitText,
} from "@/services/handoff.service";

const keys = {
  completeness: (p: string, ph: string) => ["handoff-completeness", p, ph] as const,
  submissions: (p: string, ph: string) => ["handoff-submissions", p, ph] as const,
  production: (p: string, ph: string) => ["handoff-production", p, ph] as const,
  outputs: (runId: string) => ["handoff-outputs", runId] as const,
};

export function useHandoffCompleteness(projectId: string, phase: string, enabled = true) {
  return useQuery({
    queryKey: keys.completeness(projectId, phase),
    queryFn: () => getCompleteness(projectId, phase),
    enabled: enabled && !!projectId && !!phase,
    staleTime: 30_000,
  });
}

export function useHandoffSubmissions(projectId: string, phase: string, enabled = true) {
  return useQuery({
    queryKey: keys.submissions(projectId, phase),
    queryFn: () => listSubmissions(projectId, phase),
    enabled: enabled && !!projectId && !!phase,
    staleTime: 30_000,
  });
}

export function useLatestProduction(projectId: string, phase: string, enabled = true) {
  return useQuery({
    queryKey: keys.production(projectId, phase),
    queryFn: () => getLatestProduction(projectId, phase),
    enabled: enabled && !!projectId && !!phase,
    // Self-poll every 3s while the run is still working; stop once terminal.
    refetchInterval: (query) => {
      const status = (query.state.data as HandoffProduction | null | undefined)?.status;
      return status && !isTerminalStatus(status) ? 3_000 : false;
    },
  });
}

export function useHandoffOutputs(productionId: string | null | undefined, ready: boolean) {
  return useQuery({
    queryKey: keys.outputs(productionId ?? "none"),
    queryFn: () => listOutputs(productionId as string),
    enabled: !!productionId && ready,
    staleTime: 60_000,
  });
}

/** Invalidate everything a submission change affects. */
function useInvalidateHandoff(projectId: string, phase: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.completeness(projectId, phase) });
    qc.invalidateQueries({ queryKey: keys.submissions(projectId, phase) });
  };
}

export function useSubmitText(projectId: string, phase: string) {
  const invalidate = useInvalidateHandoff(projectId, phase);
  return useMutation({
    mutationFn: (v: { componentSlug: string; text: string }) =>
      submitText(projectId, phase, v.componentSlug, v.text),
    onSuccess: invalidate,
  });
}

export function useSubmitLink(projectId: string, phase: string) {
  const invalidate = useInvalidateHandoff(projectId, phase);
  return useMutation({
    mutationFn: (v: { componentSlug: string; type: HandoffLinkType; url: string }) =>
      submitLink(projectId, phase, v.componentSlug, v.type, v.url),
    onSuccess: invalidate,
  });
}

export function useSubmitFile(projectId: string, phase: string) {
  const invalidate = useInvalidateHandoff(projectId, phase);
  return useMutation({
    mutationFn: (v: { componentSlug: string; file: File }) =>
      submitFile(projectId, phase, v.componentSlug, v.file),
    onSuccess: invalidate,
  });
}

export function useDeleteSubmission(projectId: string, phase: string) {
  const invalidate = useInvalidateHandoff(projectId, phase);
  return useMutation({
    mutationFn: (id: string) => deleteSubmission(id),
    onSuccess: invalidate,
  });
}

export function useProduceHandoffs(projectId: string, phase: string) {
  const qc = useQueryClient();
  return useMutation({
    // audiences omitted = full production; a subset = a targeted re-create (server enforces the budget).
    mutationFn: (audiences?: HandoffAudience[]) => produceHandoffs(projectId, phase, audiences),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.production(projectId, phase) }),
  });
}

export function useRunBudget(projectId: string, phase: string, enabled = true) {
  return useQuery({
    queryKey: ["handoff-budget", projectId, phase] as const,
    queryFn: () => getRunBudget(projectId, phase),
    enabled: enabled && !!projectId && !!phase,
    staleTime: 15_000,
  });
}

export function useHandoffFeedback(productionId: string | null | undefined) {
  return useQuery({
    queryKey: ["handoff-feedback", productionId ?? "none"] as const,
    queryFn: () => listFeedback(productionId as string),
    enabled: !!productionId,
    staleTime: 30_000,
  });
}

export function useSubmitFeedback(productionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { audience: HandoffAudience; rating: HandoffRating; note?: string }) =>
      submitFeedback(productionId, v.audience, v.rating, v.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["handoff-feedback", productionId] }),
  });
}
