import { Schema } from "effect";
import { EventId, IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ModelSelection } from "./orchestration";

export const PatchProfileId = TrimmedNonEmptyString.pipe(Schema.brand("PatchProfileId"));
export type PatchProfileId = typeof PatchProfileId.Type;

export const PatchRunId = TrimmedNonEmptyString.pipe(Schema.brand("PatchRunId"));
export type PatchRunId = typeof PatchRunId.Type;

export const PatchConflictId = TrimmedNonEmptyString.pipe(Schema.brand("PatchConflictId"));
export type PatchConflictId = typeof PatchConflictId.Type;

export const PatchValidationResultId = TrimmedNonEmptyString.pipe(
  Schema.brand("PatchValidationResultId"),
);
export type PatchValidationResultId = typeof PatchValidationResultId.Type;

export const PatchTargetId = TrimmedNonEmptyString.pipe(Schema.brand("PatchTargetId"));
export type PatchTargetId = typeof PatchTargetId.Type;

export const PatchStrategy = Schema.Literals(["commit-stack", "hybrid"]);
export type PatchStrategy = typeof PatchStrategy.Type;

export const PatchProfileStatus = Schema.Literals(["missing", "ready", "invalid"]);
export type PatchProfileStatus = typeof PatchProfileStatus.Type;

export const PatchRunStatus = Schema.Literals([
  "reconciling",
  "conflicted",
  "validation_failed",
  "ready_for_review",
  "applied",
  "discarded",
  "failed",
]);
export type PatchRunStatus = typeof PatchRunStatus.Type;

export const PatchStatusState = Schema.Literals([
  "up_to_date",
  "upstream_update_available",
  "patch_profile_missing",
  "patch_profile_ready",
  "reconciling",
  "resolved_automatically",
  "ready_for_review",
  "validation_failed",
  "needs_manual_investigation",
  "ready_to_apply",
]);
export type PatchStatusState = typeof PatchStatusState.Type;

export const PatchConflictKind = Schema.Literals([
  "content",
  "rename",
  "delete-modify",
  "api-shift",
  "unknown",
]);
export type PatchConflictKind = typeof PatchConflictKind.Type;

export const PatchConflictResolver = Schema.Literals(["git", "rerere", "agent", "manual"]);
export type PatchConflictResolver = typeof PatchConflictResolver.Type;

export const PatchValidationStatus = Schema.Literals([
  "pending",
  "running",
  "passed",
  "failed",
  "skipped",
]);
export type PatchValidationStatus = typeof PatchValidationStatus.Type;

export const PatchLogLevel = Schema.Literals(["info", "warn", "error"]);
export type PatchLogLevel = typeof PatchLogLevel.Type;

export const PatchFallbackMode = Schema.Literals(["needs-review"]);
export type PatchFallbackMode = typeof PatchFallbackMode.Type;

export const PatchTarget = Schema.Struct({
  id: PatchTargetId,
  profileId: PatchProfileId,
  area: TrimmedNonEmptyString,
  intent: TrimmedNonEmptyString,
  pathGlobs: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  notes: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  priority: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type PatchTarget = typeof PatchTarget.Type;

export const PatchProfile = Schema.Struct({
  id: PatchProfileId,
  repoRoot: TrimmedNonEmptyString,
  upstreamOwner: TrimmedNonEmptyString,
  upstreamRepo: TrimmedNonEmptyString,
  upstreamDefaultBranch: TrimmedNonEmptyString,
  trackedBranch: TrimmedNonEmptyString,
  upstreamRemoteName: TrimmedNonEmptyString,
  forkRemoteName: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  baseCommit: TrimmedNonEmptyString,
  patchStrategy: PatchStrategy,
  testCommands: Schema.Array(TrimmedNonEmptyString),
  smokeCommands: Schema.Array(TrimmedNonEmptyString),
  fallback: PatchFallbackMode,
  status: PatchProfileStatus,
  sourcePath: TrimmedNonEmptyString,
  sourceMarkdown: TrimmedNonEmptyString,
  targets: Schema.Array(PatchTarget).pipe(Schema.withDecodingDefault(() => [])),
});
export type PatchProfile = typeof PatchProfile.Type;

export const PatchValidationResult = Schema.Struct({
  id: PatchValidationResultId,
  patchRunId: PatchRunId,
  command: TrimmedNonEmptyString,
  exitCode: Schema.NullOr(Schema.Int),
  outputExcerpt: Schema.String,
  status: PatchValidationStatus,
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type PatchValidationResult = typeof PatchValidationResult.Type;

export const PatchConflict = Schema.Struct({
  id: PatchConflictId,
  patchRunId: PatchRunId,
  filePath: TrimmedNonEmptyString,
  conflictKind: PatchConflictKind,
  resolver: PatchConflictResolver,
  confidence: NonNegativeInt,
  summary: TrimmedNonEmptyString,
  resolved: Schema.Boolean,
});
export type PatchConflict = typeof PatchConflict.Type;

export const PatchLogEntry = Schema.Struct({
  id: EventId,
  patchRunId: PatchRunId,
  level: PatchLogLevel,
  message: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type PatchLogEntry = typeof PatchLogEntry.Type;

export const PatchReport = Schema.Struct({
  summaryMarkdown: Schema.String,
  upstreamSummary: Schema.String,
  forkSummary: Schema.String,
  diffStat: Schema.String,
});
export type PatchReport = typeof PatchReport.Type;

export const PatchRunSummary = Schema.Struct({
  id: PatchRunId,
  profileId: PatchProfileId,
  upstreamFromCommit: TrimmedNonEmptyString,
  upstreamToCommit: TrimmedNonEmptyString,
  forkHeadBefore: TrimmedNonEmptyString,
  sandboxBranch: TrimmedNonEmptyString,
  sandboxWorktreePath: TrimmedNonEmptyString,
  applyBranch: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  status: PatchRunStatus,
  confidenceScore: NonNegativeInt,
  summary: Schema.String,
  report: PatchReport,
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type PatchRunSummary = typeof PatchRunSummary.Type;

export const PatchRun = Schema.Struct({
  ...PatchRunSummary.fields,
  conflicts: Schema.Array(PatchConflict).pipe(Schema.withDecodingDefault(() => [])),
  validationResults: Schema.Array(PatchValidationResult).pipe(Schema.withDecodingDefault(() => [])),
  logs: Schema.Array(PatchLogEntry).pipe(Schema.withDecodingDefault(() => [])),
});
export type PatchRun = typeof PatchRun.Type;

export const PatchProfileSummary = Schema.Struct({
  id: PatchProfileId,
  repoRoot: TrimmedNonEmptyString,
  upstreamRepository: TrimmedNonEmptyString,
  trackedBranch: TrimmedNonEmptyString,
  baseCommit: TrimmedNonEmptyString,
  patchStrategy: PatchStrategy,
  status: PatchProfileStatus,
  testCommands: Schema.Array(TrimmedNonEmptyString),
  smokeCommands: Schema.Array(TrimmedNonEmptyString),
  targetCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type PatchProfileSummary = typeof PatchProfileSummary.Type;

export const PatchStatusResult = Schema.Struct({
  state: PatchStatusState,
  repoRoot: TrimmedNonEmptyString,
  currentBranch: Schema.NullOr(TrimmedNonEmptyString),
  currentCommit: Schema.NullOr(TrimmedNonEmptyString),
  upstreamRemoteName: Schema.NullOr(TrimmedNonEmptyString),
  forkRemoteName: Schema.NullOr(TrimmedNonEmptyString),
  upstreamRepository: Schema.NullOr(TrimmedNonEmptyString),
  forkRepository: Schema.NullOr(TrimmedNonEmptyString),
  trackedBranch: Schema.NullOr(TrimmedNonEmptyString),
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  mergeBaseCommit: Schema.NullOr(TrimmedNonEmptyString),
  profile: Schema.NullOr(PatchProfileSummary),
  activeRun: Schema.NullOr(PatchRunSummary),
  lastRun: Schema.NullOr(PatchRunSummary),
  canApply: Schema.Boolean,
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type PatchStatusResult = typeof PatchStatusResult.Type;

export const PatchStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type PatchStatusInput = typeof PatchStatusInput.Type;

export const PatchGenerateProfileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  trackedBranch: Schema.optional(TrimmedNonEmptyString),
  strategy: Schema.optional(PatchStrategy),
  testCommands: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  smokeCommands: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  targets: Schema.optional(
    Schema.Array(
      Schema.Struct({
        area: TrimmedNonEmptyString,
        intent: TrimmedNonEmptyString,
        pathGlobs: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
        notes: Schema.optional(TrimmedNonEmptyString),
        priority: Schema.optional(NonNegativeInt),
      }),
    ),
  ),
});
export type PatchGenerateProfileInput = typeof PatchGenerateProfileInput.Type;

export const PatchGenerateProfileResult = Schema.Struct({
  profile: PatchProfile,
  status: PatchStatusResult,
});
export type PatchGenerateProfileResult = typeof PatchGenerateProfileResult.Type;

export const PatchReconcileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  modelSelection: Schema.optional(ModelSelection),
});
export type PatchReconcileInput = typeof PatchReconcileInput.Type;

export const PatchGetRunInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  runId: PatchRunId,
});
export type PatchGetRunInput = typeof PatchGetRunInput.Type;

export const PatchApplyInput = PatchGetRunInput;
export type PatchApplyInput = typeof PatchApplyInput.Type;

export const PatchDiscardRunInput = PatchGetRunInput;
export type PatchDiscardRunInput = typeof PatchDiscardRunInput.Type;

export const PatchOpenSandboxInput = PatchGetRunInput;
export type PatchOpenSandboxInput = typeof PatchOpenSandboxInput.Type;

export const PatchOpenSandboxResult = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type PatchOpenSandboxResult = typeof PatchOpenSandboxResult.Type;

export const PatchApplyResult = Schema.Struct({
  run: PatchRun,
  applyBranch: TrimmedNonEmptyString,
  checkedOut: Schema.Boolean,
});
export type PatchApplyResult = typeof PatchApplyResult.Type;

export const PatchDiscardRunResult = Schema.Struct({
  run: PatchRun,
});
export type PatchDiscardRunResult = typeof PatchDiscardRunResult.Type;

export const PatchEventBase = Schema.Struct({
  runId: PatchRunId,
  cwd: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const PatchRunStartedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("run_started"),
  status: PatchRunStatus,
  message: TrimmedNonEmptyString,
});

export const PatchRunProgressEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("run_progress"),
  phase: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
});

export const PatchConflictDetectedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("conflict_detected"),
  conflict: PatchConflict,
});

export const PatchValidationCompletedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("validation_completed"),
  result: PatchValidationResult,
});

export const PatchRunFinishedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("run_finished"),
  status: PatchRunStatus,
  summary: TrimmedNonEmptyString,
});

export const PatchRunFailedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("run_failed"),
  status: PatchRunStatus,
  message: TrimmedNonEmptyString,
});

export const PatchApplyCompletedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("apply_completed"),
  applyBranch: TrimmedNonEmptyString,
  checkedOut: Schema.Boolean,
});

export const PatchRunDiscardedEvent = Schema.Struct({
  ...PatchEventBase.fields,
  kind: Schema.Literal("run_discarded"),
  message: TrimmedNonEmptyString,
});

export const PatchEvent = Schema.Union([
  PatchRunStartedEvent,
  PatchRunProgressEvent,
  PatchConflictDetectedEvent,
  PatchValidationCompletedEvent,
  PatchRunFinishedEvent,
  PatchRunFailedEvent,
  PatchApplyCompletedEvent,
  PatchRunDiscardedEvent,
]);
export type PatchEvent = typeof PatchEvent.Type;
