"use client";

import type {
  EnvironmentId,
  PatchConflict,
  PatchRun,
  PatchRunSummary,
  PatchStatusResult,
  PatchStrategy,
  PatchValidationResult,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  HammerIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import { cn } from "~/lib/utils";
import {
  invalidatePatchQueries,
  patchApplyMutationOptions,
  patchDiscardRunMutationOptions,
  patchGenerateProfileMutationOptions,
  patchOpenSandboxMutationOptions,
  patchReconcileMutationOptions,
  patchRunQueryOptions,
  patchStatusQueryOptions,
} from "~/lib/patchReactQuery";
import { readLocalApi } from "~/localApi";

interface PatchControlProps {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  activeThreadId: ThreadId | null;
}

const DEFAULT_TEST_COMMANDS = ["bun fmt", "bun lint", "bun typecheck", "bun run test"] as const;

const PATCH_STATE_LABELS: Record<PatchStatusResult["state"], string> = {
  up_to_date: "Up to date",
  upstream_update_available: "Update available",
  patch_profile_missing: "Profile missing",
  patch_profile_ready: "Profile ready",
  reconciling: "Reconciling",
  resolved_automatically: "Resolved automatically",
  ready_for_review: "Ready for review",
  validation_failed: "Validation failed",
  needs_manual_investigation: "Needs review",
  ready_to_apply: "Ready to apply",
};

function patchStateVariant(
  state: PatchStatusResult["state"],
): "outline" | "info" | "success" | "warning" | "error" {
  switch (state) {
    case "up_to_date":
    case "patch_profile_ready":
    case "resolved_automatically":
      return "success";
    case "upstream_update_available":
    case "needs_manual_investigation":
      return "warning";
    case "reconciling":
      return "info";
    case "ready_for_review":
    case "ready_to_apply":
      return "success";
    case "validation_failed":
      return "error";
    case "patch_profile_missing":
    default:
      return "outline";
  }
}

function formatRunStatus(status: PatchRunSummary["status"]): string {
  return status.replaceAll("_", " ");
}

function formatValidationStatus(status: PatchValidationResult["status"]): string {
  return status.replaceAll("_", " ");
}

function formatConfidence(score: number): string {
  return `${Math.max(0, Math.min(100, score))}%`;
}

function splitMultilineList(input: string): string[] {
  return input
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getReviewRunSummary(status: PatchStatusResult | null): PatchRunSummary | null {
  if (!status) return null;
  if (status.activeRun && status.activeRun.status !== "reconciling") {
    return status.activeRun;
  }
  return status.lastRun;
}

function canDiscardRun(run: PatchRunSummary | PatchRun | null): boolean {
  if (!run) return false;
  return run.status !== "reconciling" && run.status !== "applied" && run.status !== "discarded";
}

function PatchStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-muted/48 p-3", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function ValidationRow({ result }: { result: PatchValidationResult }) {
  return (
    <div className="rounded-lg border bg-background/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-xs text-foreground">{result.command}</code>
        <Badge size="sm" variant={result.status === "passed" ? "success" : "warning"}>
          {formatValidationStatus(result.status)}
        </Badge>
      </div>
      {result.outputExcerpt.trim().length > 0 && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/56 p-2 text-[11px] text-muted-foreground">
          {result.outputExcerpt}
        </pre>
      )}
    </div>
  );
}

function ConflictRow({ conflict }: { conflict: PatchConflict }) {
  return (
    <div className="rounded-lg border bg-background/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-xs text-foreground">{conflict.filePath}</code>
        <Badge size="sm" variant={conflict.resolved ? "success" : "warning"}>
          {conflict.conflictKind}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{conflict.summary}</p>
    </div>
  );
}

export default function PatchControl({ environmentId, gitCwd, activeThreadId }: PatchControlProps) {
  const queryClient = useQueryClient();
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );
  const [isInitDialogOpen, setIsInitDialogOpen] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [trackedBranch, setTrackedBranch] = useState("main");
  const [strategy, setStrategy] = useState<PatchStrategy>("commit-stack");
  const [testCommandsText, setTestCommandsText] = useState(DEFAULT_TEST_COMMANDS.join("\n"));
  const [smokeCommandsText, setSmokeCommandsText] = useState("");

  const statusQuery = useQuery(patchStatusQueryOptions({ environmentId, cwd: gitCwd }));
  const patchStatus = statusQuery.data ?? null;
  const reviewRunSummary = useMemo(() => getReviewRunSummary(patchStatus), [patchStatus]);
  const reviewRunQuery = useQuery(
    patchRunQueryOptions({
      cwd: gitCwd,
      environmentId,
      runId: isReviewDialogOpen ? (reviewRunSummary?.id ?? null) : null,
    }),
  );

  const generateProfileMutation = useMutation(
    patchGenerateProfileMutationOptions({ environmentId, cwd: gitCwd, queryClient }),
  );
  const reconcileMutation = useMutation(
    patchReconcileMutationOptions({
      environmentId,
      cwd: gitCwd,
      queryClient,
    }),
  );
  const applyMutation = useMutation(
    patchApplyMutationOptions({ environmentId, cwd: gitCwd, queryClient }),
  );
  const openSandboxMutation = useMutation(
    patchOpenSandboxMutationOptions({ environmentId, cwd: gitCwd }),
  );
  const discardRunMutation = useMutation(
    patchDiscardRunMutationOptions({ environmentId, cwd: gitCwd, queryClient }),
  );

  useEffect(() => {
    if (!isInitDialogOpen) return;
    const profile = patchStatus?.profile;
    setTrackedBranch(profile?.trackedBranch ?? patchStatus?.trackedBranch ?? "main");
    setStrategy(profile?.patchStrategy ?? "commit-stack");
    setTestCommandsText((profile?.testCommands ?? Array.from(DEFAULT_TEST_COMMANDS)).join("\n"));
    setSmokeCommandsText((profile?.smokeCommands ?? []).join("\n"));
  }, [isInitDialogOpen, patchStatus]);

  const handleGenerateProfile = useCallback(() => {
    generateProfileMutation.mutate(
      {
        trackedBranch: trackedBranch.trim() || "main",
        strategy,
        testCommands: splitMultilineList(testCommandsText),
        smokeCommands: splitMultilineList(smokeCommandsText),
      },
      {
        onSuccess: () => {
          setIsInitDialogOpen(false);
          toastManager.add({
            type: "success",
            title: "Patch profile created",
            description: "Saved patch.md for this fork.",
            data: threadToastData,
          });
        },
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Unable to create patch profile",
            description: error instanceof Error ? error.message : "An error occurred.",
            data: threadToastData,
          });
        },
      },
    );
  }, [
    generateProfileMutation,
    smokeCommandsText,
    strategy,
    testCommandsText,
    threadToastData,
    trackedBranch,
  ]);

  const handleReconcile = useCallback(() => {
    reconcileMutation.mutate(undefined, {
      onSuccess: (run) => {
        toastManager.add({
          type: run.status === "ready_for_review" ? "success" : "info",
          title: "Patch run finished",
          description: run.summary || formatRunStatus(run.status),
          data: threadToastData,
        });
      },
      onError: (error) => {
        toastManager.add({
          type: "error",
          title: "Unable to reconcile patch layer",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      },
    });
  }, [reconcileMutation, threadToastData]);

  const handleOpenSandbox = useCallback(
    (runId: PatchRunSummary["id"]) => {
      openSandboxMutation.mutate(runId, {
        onSuccess: async ({ path }) => {
          const api = readLocalApi();
          if (!api) {
            toastManager.add({
              type: "error",
              title: "Editor opening is unavailable.",
              data: threadToastData,
            });
            return;
          }
          try {
            await openInPreferredEditor(api, path);
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Unable to open sandbox",
              description: error instanceof Error ? error.message : "An error occurred.",
              data: threadToastData,
            });
            return;
          }
          toastManager.add({
            type: "success",
            title: "Sandbox opened",
            description: path,
            data: threadToastData,
          });
        },
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Unable to open sandbox",
            description: error instanceof Error ? error.message : "An error occurred.",
            data: threadToastData,
          });
        },
      });
    },
    [openSandboxMutation, threadToastData],
  );

  const handleApply = useCallback(() => {
    if (!reviewRunSummary) return;
    applyMutation.mutate(reviewRunSummary.id, {
      onSuccess: (result) => {
        setIsReviewDialogOpen(false);
        toastManager.add({
          type: "success",
          title: "Patch apply prepared",
          description: result.checkedOut
            ? `Checked out ${result.applyBranch}.`
            : `Created ${result.applyBranch}.`,
          data: threadToastData,
        });
      },
      onError: (error) => {
        toastManager.add({
          type: "error",
          title: "Unable to prepare patch apply branch",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      },
    });
  }, [applyMutation, reviewRunSummary, threadToastData]);

  const handleDiscard = useCallback(() => {
    if (!reviewRunSummary) return;
    discardRunMutation.mutate(reviewRunSummary.id, {
      onSuccess: () => {
        setIsReviewDialogOpen(false);
        toastManager.add({
          type: "info",
          title: "Patch run discarded",
          data: threadToastData,
        });
      },
      onError: (error) => {
        toastManager.add({
          type: "error",
          title: "Unable to discard patch run",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      },
    });
  }, [discardRunMutation, reviewRunSummary, threadToastData]);

  const handleOpenReview = useCallback(() => {
    void invalidatePatchQueries(queryClient);
    setIsReviewDialogOpen(true);
  }, [queryClient]);

  const isBusy =
    statusQuery.isFetching ||
    generateProfileMutation.isPending ||
    reconcileMutation.isPending ||
    applyMutation.isPending ||
    openSandboxMutation.isPending ||
    discardRunMutation.isPending;

  const controlStatus = patchStatus?.state ?? "patch_profile_missing";
  const controlLabel = PATCH_STATE_LABELS[controlStatus];
  const canReconcile =
    !!patchStatus?.profile &&
    patchStatus.activeRun?.status !== "reconciling" &&
    !reconcileMutation.isPending;
  const reviewRun = reviewRunQuery.data ?? null;

  if (!gitCwd) return null;

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button aria-label="Patch layer controls" size="xs" variant="outline" type="button" />
          }
        >
          {controlStatus === "reconciling" || isBusy ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : controlStatus === "validation_failed" ||
            controlStatus === "needs_manual_investigation" ? (
            <AlertTriangleIcon className="size-3.5" />
          ) : controlStatus === "ready_to_apply" || controlStatus === "up_to_date" ? (
            <CheckCircle2Icon className="size-3.5" />
          ) : (
            <HammerIcon className="size-3.5" />
          )}
          <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
            Patch
          </span>
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-[min(28rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">Patch Layer</h3>
                  <p className="text-xs text-muted-foreground">
                    Keep fork-specific changes aligned with upstream in a sandbox worktree.
                  </p>
                </div>
                <Badge size="sm" variant={patchStateVariant(controlStatus)}>
                  {controlLabel}
                </Badge>
              </div>
              {patchStatus?.message && (
                <p className="text-xs text-muted-foreground">{patchStatus.message}</p>
              )}
              {statusQuery.error && (
                <p className="text-xs text-destructive-foreground">
                  {statusQuery.error instanceof Error
                    ? statusQuery.error.message
                    : "Unable to load patch status."}
                </p>
              )}
            </div>

            {patchStatus && (
              <div className="grid grid-cols-2 gap-2">
                <PatchStat label="Ahead" value={`${patchStatus.aheadCount}`} />
                <PatchStat label="Behind" value={`${patchStatus.behindCount}`} />
                <PatchStat
                  label="Tracked branch"
                  value={patchStatus.profile?.trackedBranch ?? patchStatus.trackedBranch ?? "main"}
                />
                <PatchStat
                  label="Last run"
                  value={patchStatus.lastRun ? formatRunStatus(patchStatus.lastRun.status) : "None"}
                />
              </div>
            )}

            {patchStatus?.profile ? (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Profile
                  </p>
                  <Badge size="sm" variant="outline">
                    {patchStatus.profile.patchStrategy}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-foreground">
                  {patchStatus.profile.upstreamRepository}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {patchStatus.profile.targetCount} target
                  {patchStatus.profile.targetCount === 1 ? "" : "s"} configured
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/24 p-3 text-xs text-muted-foreground">
                No `patch.md` detected yet. Generate one before running reconciliation.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setIsInitDialogOpen(true)}
                size="sm"
                variant={patchStatus?.profile ? "outline" : "default"}
              >
                <FileTextIcon className="size-3.5" />
                {patchStatus?.profile ? "Edit profile" : "Generate profile"}
              </Button>
              <Button
                disabled={!canReconcile}
                onClick={handleReconcile}
                size="sm"
                variant="outline"
              >
                <RefreshCwIcon
                  className={cn("size-3.5", reconcileMutation.isPending && "animate-spin")}
                />
                Reconcile
              </Button>
              {reviewRunSummary && (
                <Button onClick={handleOpenReview} size="sm" variant="outline">
                  Review run
                </Button>
              )}
              {reviewRunSummary && (
                <Button
                  disabled={openSandboxMutation.isPending}
                  onClick={() => handleOpenSandbox(reviewRunSummary.id)}
                  size="sm"
                  variant="outline"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open sandbox
                </Button>
              )}
            </div>
          </div>
        </PopoverPopup>
      </Popover>

      <Dialog open={isInitDialogOpen} onOpenChange={setIsInitDialogOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Patch Profile</DialogTitle>
            <DialogDescription>
              Configure the canonical `patch.md` file that describes how this fork should be
              replayed onto upstream.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Tracked branch</span>
                <Input
                  nativeInput
                  onChange={(event) => setTrackedBranch(event.currentTarget.value)}
                  placeholder="main"
                  value={trackedBranch}
                />
              </label>
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Strategy</span>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setStrategy("commit-stack")}
                    size="sm"
                    variant={strategy === "commit-stack" ? "default" : "outline"}
                  >
                    Commit stack
                  </Button>
                  <Button
                    onClick={() => setStrategy("hybrid")}
                    size="sm"
                    variant={strategy === "hybrid" ? "default" : "outline"}
                  >
                    Hybrid
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  V1 reconciliation still replays commit stacks in the sandbox.
                </p>
              </div>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Validation commands</span>
              <Textarea
                onChange={(event) => setTestCommandsText(event.currentTarget.value)}
                placeholder="One command per line"
                value={testCommandsText}
              />
              <p className="text-xs text-muted-foreground">
                Default validation runs `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
              </p>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Smoke commands</span>
              <Textarea
                onChange={(event) => setSmokeCommandsText(event.currentTarget.value)}
                placeholder="Optional smoke commands, one per line"
                value={smokeCommandsText}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setIsInitDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={generateProfileMutation.isPending} onClick={handleGenerateProfile}>
              {generateProfileMutation.isPending ? "Saving..." : "Save patch.md"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogPopup className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Patch Review</DialogTitle>
            <DialogDescription>
              Review the latest sandbox reconciliation before applying it back to your fork.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-6">
            {reviewRunQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Loading patch run details...
              </div>
            )}
            {reviewRunQuery.error && (
              <p className="text-sm text-destructive-foreground">
                {reviewRunQuery.error instanceof Error
                  ? reviewRunQuery.error.message
                  : "Unable to load patch run details."}
              </p>
            )}
            {!reviewRunQuery.isLoading && !reviewRunQuery.error && !reviewRun && (
              <p className="text-sm text-muted-foreground">No completed patch run is available.</p>
            )}
            {reviewRun && (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <PatchStat label="Status" value={formatRunStatus(reviewRun.status)} />
                  <PatchStat
                    label="Confidence"
                    value={formatConfidence(reviewRun.confidenceScore)}
                  />
                  <PatchStat label="Conflicts" value={`${reviewRun.conflicts.length}`} />
                  <PatchStat
                    label="Validation"
                    value={`${reviewRun.validationResults.length} command${
                      reviewRun.validationResults.length === 1 ? "" : "s"
                    }`}
                  />
                </div>

                <ReviewSection title="Summary">
                  <div className="whitespace-pre-wrap rounded-lg border bg-muted/32 p-3 text-xs text-foreground">
                    {reviewRun.report.summaryMarkdown}
                  </div>
                </ReviewSection>

                <div className="grid gap-4 lg:grid-cols-2">
                  <ReviewSection title="Upstream changes">
                    <div className="whitespace-pre-wrap rounded-lg border bg-background/80 p-3 text-xs text-foreground">
                      {reviewRun.report.upstreamSummary || "No upstream changes summarized."}
                    </div>
                  </ReviewSection>
                  <ReviewSection title="Fork customizations">
                    <div className="whitespace-pre-wrap rounded-lg border bg-background/80 p-3 text-xs text-foreground">
                      {reviewRun.report.forkSummary || "No fork-only changes summarized."}
                    </div>
                  </ReviewSection>
                </div>

                <ReviewSection title="Diff stat">
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-background/80 p-3 text-[11px] text-muted-foreground">
                    {reviewRun.report.diffStat || "No diff stat available."}
                  </pre>
                </ReviewSection>

                <ReviewSection title="Validation">
                  <div className="space-y-2">
                    {reviewRun.validationResults.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No validation results were recorded.
                      </p>
                    ) : (
                      reviewRun.validationResults.map((result) => (
                        <ValidationRow key={result.id} result={result} />
                      ))
                    )}
                  </div>
                </ReviewSection>

                <ReviewSection title="Conflicts">
                  <div className="space-y-2">
                    {reviewRun.conflicts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No conflicts were recorded.</p>
                    ) : (
                      reviewRun.conflicts.map((conflict) => (
                        <ConflictRow key={conflict.id} conflict={conflict} />
                      ))
                    )}
                  </div>
                </ReviewSection>
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              disabled={!reviewRunSummary || openSandboxMutation.isPending}
              onClick={() => reviewRunSummary && handleOpenSandbox(reviewRunSummary.id)}
              variant="outline"
            >
              Open sandbox
            </Button>
            <Button
              disabled={!canDiscardRun(reviewRun) || discardRunMutation.isPending}
              onClick={handleDiscard}
              variant="destructive-outline"
            >
              Discard run
            </Button>
            <Button
              disabled={reviewRun?.status !== "ready_for_review" || applyMutation.isPending}
              onClick={handleApply}
            >
              Apply patch branch
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
