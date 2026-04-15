import type {
  ModelSelection,
  PatchApplyResult,
  PatchGenerateProfileInput,
  PatchGenerateProfileResult,
  PatchOpenSandboxResult,
  PatchRun,
  PatchRunId,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const PATCH_STATUS_STALE_TIME_MS = 10_000;
const PATCH_STATUS_REFETCH_INTERVAL_MS = 20_000;
const PATCH_RUN_STALE_TIME_MS = 5_000;

export const patchQueryKeys = {
  all: ["patch"] as const,
  status: (cwd: string | null) => ["patch", "status", cwd] as const,
  run: (cwd: string | null, runId: PatchRunId | null) => ["patch", "run", cwd, runId] as const,
};

export const patchMutationKeys = {
  generateProfile: (cwd: string | null) => ["patch", "mutation", "generate-profile", cwd] as const,
  reconcile: (cwd: string | null) => ["patch", "mutation", "reconcile", cwd] as const,
  apply: (cwd: string | null) => ["patch", "mutation", "apply", cwd] as const,
  openSandbox: (cwd: string | null) => ["patch", "mutation", "open-sandbox", cwd] as const,
  discardRun: (cwd: string | null) => ["patch", "mutation", "discard-run", cwd] as const,
};

export function invalidatePatchQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: patchQueryKeys.all });
}

export function patchStatusQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: patchQueryKeys.status(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) throw new Error("Patch status is unavailable.");
      return api.patch.status({ cwd });
    },
    enabled: cwd !== null,
    staleTime: PATCH_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: PATCH_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function patchRunQueryOptions(input: { cwd: string | null; runId: PatchRunId | null }) {
  return queryOptions({
    queryKey: patchQueryKeys.run(input.cwd, input.runId),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.runId) {
        throw new Error("Patch run details are unavailable.");
      }
      return api.patch.getRun({ cwd: input.cwd, runId: input.runId });
    },
    enabled: input.cwd !== null && input.runId !== null,
    staleTime: PATCH_RUN_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function patchGenerateProfileMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.generateProfile(input.cwd),
    mutationFn: async (
      values: Omit<PatchGenerateProfileInput, "cwd">,
    ): Promise<PatchGenerateProfileResult> => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Patch profile generation is unavailable.");
      return api.patch.generateProfile({ cwd: input.cwd, ...values });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchReconcileMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  modelSelection: ModelSelection;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.reconcile(input.cwd),
    mutationFn: async (): Promise<PatchRun> => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Patch reconciliation is unavailable.");
      return api.patch.reconcile({
        cwd: input.cwd,
        modelSelection: input.modelSelection,
      });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchApplyMutationOptions(input: { cwd: string | null; queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: patchMutationKeys.apply(input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchApplyResult> => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Patch apply is unavailable.");
      return api.patch.apply({ cwd: input.cwd, runId });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchOpenSandboxMutationOptions(input: { cwd: string | null }) {
  return mutationOptions({
    mutationKey: patchMutationKeys.openSandbox(input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchOpenSandboxResult> => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Patch sandbox access is unavailable.");
      return api.patch.openSandbox({ cwd: input.cwd, runId });
    },
  });
}

export function patchDiscardRunMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.discardRun(input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchRun> => {
      const api = ensureNativeApi();
      if (!input.cwd) throw new Error("Patch run discard is unavailable.");
      const result = await api.patch.discardRun({ cwd: input.cwd, runId });
      return result.run;
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}
