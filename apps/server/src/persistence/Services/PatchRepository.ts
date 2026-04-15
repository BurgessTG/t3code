import {
  PatchLogEntry,
  PatchProfile,
  PatchProfileId,
  PatchRun,
  PatchRunId,
  PatchRunSummary,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetPatchProfileByRepoRootInput = Schema.Struct({
  repoRoot: TrimmedNonEmptyString,
});
export type GetPatchProfileByRepoRootInput = typeof GetPatchProfileByRepoRootInput.Type;

export const GetPatchProfileByIdInput = Schema.Struct({
  profileId: PatchProfileId,
});
export type GetPatchProfileByIdInput = typeof GetPatchProfileByIdInput.Type;

export const GetPatchRunInput = Schema.Struct({
  runId: PatchRunId,
});
export type GetPatchRunInput = typeof GetPatchRunInput.Type;

export const ListPatchRunsInput = Schema.Struct({
  profileId: PatchProfileId,
});
export type ListPatchRunsInput = typeof ListPatchRunsInput.Type;

export interface PatchRepositoryShape {
  readonly upsertProfile: (profile: PatchProfile) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getProfileByRepoRoot: (
    input: GetPatchProfileByRepoRootInput,
  ) => Effect.Effect<Option.Option<PatchProfile>, ProjectionRepositoryError>;
  readonly getProfileById: (
    input: GetPatchProfileByIdInput,
  ) => Effect.Effect<Option.Option<PatchProfile>, ProjectionRepositoryError>;
  readonly upsertRun: (run: PatchRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getRun: (
    input: GetPatchRunInput,
  ) => Effect.Effect<Option.Option<PatchRun>, ProjectionRepositoryError>;
  readonly listRuns: (
    input: ListPatchRunsInput,
  ) => Effect.Effect<ReadonlyArray<PatchRunSummary>, ProjectionRepositoryError>;
  readonly appendLogs: (
    runId: PatchRunId,
    logs: ReadonlyArray<PatchLogEntry>,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class PatchRepository extends ServiceMap.Service<PatchRepository, PatchRepositoryShape>()(
  "t3/persistence/Services/PatchRepository",
) {}
