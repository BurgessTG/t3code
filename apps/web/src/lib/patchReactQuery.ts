import type {
  EnvironmentId,
  ModelSelection,
  PatchApplyResult,
  PatchGenerateProfileInput,
  PatchGenerateProfileResult,
  PatchOpenSandboxResult,
  PatchRun,
  PatchRunId,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

const PATCH_STATUS_STALE_TIME_MS = 10_000;
const PATCH_STATUS_REFETCH_INTERVAL_MS = 20_000;
const PATCH_RUN_STALE_TIME_MS = 5_000;

export const patchQueryKeys = {
  all: ["patch"] as const,
  status: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "status", cwd] as const,
  run: (environmentId: EnvironmentId, cwd: string | null, runId: PatchRunId | null) =>
    ["patch", environmentId, "run", cwd, runId] as const,
};

export const patchMutationKeys = {
  generateProfile: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "mutation", "generate-profile", cwd] as const,
  reconcile: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "mutation", "reconcile", cwd] as const,
  apply: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "mutation", "apply", cwd] as const,
  openSandbox: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "mutation", "open-sandbox", cwd] as const,
  discardRun: (environmentId: EnvironmentId, cwd: string | null) =>
    ["patch", environmentId, "mutation", "discard-run", cwd] as const,
};

export function invalidatePatchQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: patchQueryKeys.all });
}

export function patchStatusQueryOptions(input: { environmentId: EnvironmentId; cwd: string | null }) {
  return queryOptions({
    queryKey: patchQueryKeys.status(input.environmentId, input.cwd),
    queryFn: async () => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch status is unavailable.");
      return api.patch.status({ cwd: input.cwd });
    },
    enabled: input.cwd !== null,
    staleTime: PATCH_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: PATCH_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function patchRunQueryOptions(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  runId: PatchRunId | null;
}) {
  return queryOptions({
    queryKey: patchQueryKeys.run(input.environmentId, input.cwd, input.runId),
    queryFn: async () => {
      const api = ensureEnvironmentApi(input.environmentId);
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
  environmentId: EnvironmentId;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.generateProfile(input.environmentId, input.cwd),
    mutationFn: async (
      values: Omit<PatchGenerateProfileInput, "cwd">,
    ): Promise<PatchGenerateProfileResult> => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch profile generation is unavailable.");
      return api.patch.generateProfile({ cwd: input.cwd, ...values });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchReconcileMutationOptions(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  queryClient: QueryClient;
  modelSelection?: ModelSelection;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.reconcile(input.environmentId, input.cwd),
    mutationFn: async (): Promise<PatchRun> => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch reconciliation is unavailable.");
      return api.patch.reconcile({
        cwd: input.cwd,
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchApplyMutationOptions(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.apply(input.environmentId, input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchApplyResult> => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch apply is unavailable.");
      return api.patch.apply({ cwd: input.cwd, runId });
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}

export function patchOpenSandboxMutationOptions(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.openSandbox(input.environmentId, input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchOpenSandboxResult> => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch sandbox access is unavailable.");
      return api.patch.openSandbox({ cwd: input.cwd, runId });
    },
  });
}

export function patchDiscardRunMutationOptions(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: patchMutationKeys.discardRun(input.environmentId, input.cwd),
    mutationFn: async (runId: PatchRunId): Promise<PatchRun> => {
      const api = ensureEnvironmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Patch run discard is unavailable.");
      const result = await api.patch.discardRun({ cwd: input.cwd, runId });
      return result.run;
    },
    onSettled: async () => {
      await invalidatePatchQueries(input.queryClient);
    },
  });
}
