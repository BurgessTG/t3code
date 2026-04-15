import {
  PatchApplyInput,
  PatchApplyResult,
  PatchDiscardRunInput,
  PatchDiscardRunResult,
  PatchEvent,
  PatchGenerateProfileInput,
  PatchGenerateProfileResult,
  PatchGetRunInput,
  PatchOpenSandboxInput,
  PatchOpenSandboxResult,
  PatchReconcileInput,
  PatchRun,
  PatchStatusInput,
  PatchStatusResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";
import type { PatchServiceError } from "../Errors.ts";

export interface PatchEventPublisher {
  readonly publish: (event: PatchEvent) => Effect.Effect<void, never>;
}

export interface PatchServiceOptions {
  readonly eventPublisher?: PatchEventPublisher;
}

export interface PatchServiceShape {
  readonly status: (input: PatchStatusInput) => Effect.Effect<PatchStatusResult, PatchServiceError>;
  readonly generateProfile: (
    input: PatchGenerateProfileInput,
  ) => Effect.Effect<PatchGenerateProfileResult, PatchServiceError>;
  readonly reconcile: (
    input: PatchReconcileInput,
    options?: PatchServiceOptions,
  ) => Effect.Effect<PatchRun, PatchServiceError>;
  readonly getRun: (input: PatchGetRunInput) => Effect.Effect<PatchRun, PatchServiceError>;
  readonly apply: (
    input: PatchApplyInput,
    options?: PatchServiceOptions,
  ) => Effect.Effect<PatchApplyResult, PatchServiceError>;
  readonly openSandbox: (
    input: PatchOpenSandboxInput,
  ) => Effect.Effect<PatchOpenSandboxResult, PatchServiceError>;
  readonly discardRun: (
    input: PatchDiscardRunInput,
    options?: PatchServiceOptions,
  ) => Effect.Effect<PatchDiscardRunResult, PatchServiceError>;
}

export class PatchService extends Context.Service<PatchService, PatchServiceShape>()(
  "t3/patch/Services/PatchService",
) {}
