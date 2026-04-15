import { createHash, randomUUID } from "node:crypto";

import {
  EventId,
  PatchConflictId,
  PatchProfileId,
  PatchRunId,
  PatchTargetId,
  PatchValidationResultId,
  type PatchConflict,
  type PatchEvent,
  type PatchGenerateProfileInput,
  type PatchLogEntry,
  type PatchProfile as PatchProfileType,
  type PatchProfileSummary,
  type PatchReport,
  type PatchRun,
  type PatchRunSummary,
  type PatchStatusResult,
  type PatchValidationResult,
} from "@t3tools/contracts";
import {
  normalizePatchMarkdownInput,
  parsePatchMarkdown,
  serializePatchMarkdown,
} from "@t3tools/shared/patch";
import { parseGitRemoteRepository, splitRepositoryName } from "@t3tools/shared/git";
import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { ServerConfig } from "../../config.ts";
import { runProcess } from "../../processRunner.ts";
import { PatchRepository } from "../../persistence/Services/PatchRepository.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { PatchServiceError } from "../Errors.ts";
import {
  PatchService,
  type PatchEventPublisher,
  type PatchServiceShape,
} from "../Services/PatchService.ts";

const DEFAULT_TEST_COMMANDS = ["bun fmt", "bun lint", "bun typecheck", "bun run test"] as const;
const PATCH_MARKDOWN_FILE = "patch.md";

interface RemoteDescriptor {
  name: string;
  url: string;
  repository: string | null;
}

interface RepoContext {
  repoRoot: string;
  currentBranch: string | null;
  currentCommit: string | null;
  origin: RemoteDescriptor | null;
  upstream: RemoteDescriptor | null;
}

interface ValidationExecutionResult {
  results: PatchValidationResult[];
  logs: PatchLogEntry[];
  failed: boolean;
}

function patchServiceError(operation: string, detail: string, cause?: unknown): PatchServiceError {
  return new PatchServiceError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeProfileId(repoRoot: string) {
  return PatchProfileId.makeUnsafe(
    `patch-profile-${createHash("sha1").update(repoRoot).digest("hex").slice(0, 16)}`,
  );
}

function makeRunId() {
  return PatchRunId.makeUnsafe(`patch-run-${randomUUID()}`);
}

function makeTargetId(profileId: PatchProfileType["id"], index: number) {
  return PatchTargetId.makeUnsafe(`${profileId}-target-${index + 1}`);
}

function makeConflictId(runId: PatchRun["id"], filePath: string) {
  return PatchConflictId.makeUnsafe(
    `${runId}-conflict-${createHash("sha1").update(filePath).digest("hex").slice(0, 12)}`,
  );
}

function makeValidationResultId(runId: PatchRun["id"], command: string, index: number) {
  return PatchValidationResultId.makeUnsafe(
    `${runId}-validation-${index + 1}-${createHash("sha1").update(command).digest("hex").slice(0, 8)}`,
  );
}

function makeLogEntry(
  runId: PatchRun["id"],
  level: PatchLogEntry["level"],
  message: string,
): PatchLogEntry {
  return {
    id: EventId.makeUnsafe(`patch-log-${randomUUID()}`),
    patchRunId: runId,
    level,
    message: message.trim(),
    createdAt: nowIso(),
  };
}

function toProfileSummary(profile: PatchProfileType): PatchProfileSummary {
  return {
    id: profile.id,
    repoRoot: profile.repoRoot,
    upstreamRepository: `${profile.upstreamOwner}/${profile.upstreamRepo}`,
    trackedBranch: profile.trackedBranch,
    baseCommit: profile.baseCommit,
    patchStrategy: profile.patchStrategy,
    status: profile.status,
    testCommands: profile.testCommands,
    smokeCommands: profile.smokeCommands,
    targetCount: profile.targets.length,
    updatedAt: profile.updatedAt,
  };
}

function summarizeRun(run: PatchRunSummary) {
  return run.summary.trim() || `${run.status.replace(/_/g, " ")}`;
}

function buildStatusState(input: {
  profile: PatchProfileType | null;
  behindCount: number;
  activeRun: PatchRunSummary | null;
  lastRun: PatchRunSummary | null;
}): PatchStatusResult["state"] {
  if (input.activeRun?.status === "reconciling") return "reconciling";
  if (!input.profile) return "patch_profile_missing";
  if (input.lastRun?.status === "conflicted" || input.lastRun?.status === "failed") {
    return "needs_manual_investigation";
  }
  if (input.lastRun?.status === "validation_failed") return "validation_failed";
  if (input.lastRun?.status === "ready_for_review") return "ready_to_apply";
  if (input.lastRun?.status === "applied")
    return input.behindCount > 0 ? "upstream_update_available" : "up_to_date";
  if (input.behindCount > 0) return "upstream_update_available";
  return "patch_profile_ready";
}

function buildValidationCommands(profile: PatchProfileType) {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const command of [
    ...DEFAULT_TEST_COMMANDS,
    ...profile.testCommands,
    ...profile.smokeCommands,
  ]) {
    const trimmed = command.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    commands.push(trimmed);
  }
  return commands;
}

function normalizeGenerateProfileTargets(targets: PatchGenerateProfileInput["targets"]):
  | ReadonlyArray<{
      area: string;
      intent: string;
      pathGlobs?: ReadonlyArray<string>;
      notes?: string;
      priority?: number;
    }>
  | undefined {
  if (!targets) return undefined;
  return targets.map((target) => ({
    area: target.area,
    intent: target.intent,
    pathGlobs: target.pathGlobs ? [...target.pathGlobs] : [],
    ...(target.notes ? { notes: target.notes } : {}),
    ...(target.priority !== undefined ? { priority: target.priority } : {}),
  }));
}

function classifyConflict(code: string): PatchConflict["conflictKind"] {
  if (code === "UD" || code === "DU" || code === "DD") return "delete-modify";
  if (code === "UU" || code === "AA" || code === "AU" || code === "UA") return "content";
  return "unknown";
}

const makePatchService = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitCore;
  const repository = yield* PatchRepository;
  const serverConfig = yield* ServerConfig;

  const runGit = (operation: string, cwd: string, args: string[], allowNonZeroExit = false) =>
    git
      .execute({
        operation,
        cwd,
        args,
        allowNonZeroExit,
        timeoutMs: 60_000,
        maxOutputBytes: 2_000_000,
      })
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError(operation, `git ${args.join(" ")} failed`, cause),
        ),
      );

  const emit = (publisher: PatchEventPublisher | undefined, event: PatchEvent) =>
    publisher ? publisher.publish(event) : Effect.void;

  const upsertProfileRecord = (profile: PatchProfileType) =>
    repository
      .upsertProfile(profile)
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError(
            "PatchService.upsertProfile",
            "Failed to persist patch profile.",
            cause,
          ),
        ),
      );

  const getProfileByRepoRoot = (repoRoot: string) =>
    repository
      .getProfileByRepoRoot({ repoRoot })
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError(
            "PatchService.getProfileByRepoRoot",
            "Failed to load patch profile.",
            cause,
          ),
        ),
      );

  const getProfileById = (profileId: PatchProfileType["id"]) =>
    repository
      .getProfileById({ profileId })
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError("PatchService.getProfileById", "Failed to load patch profile.", cause),
        ),
      );

  const listRunsByProfileId = (profileId: PatchProfileType["id"]) =>
    repository
      .listRuns({ profileId })
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError("PatchService.listRuns", "Failed to load patch runs.", cause),
        ),
      );

  const getRunOption = (runId: PatchRun["id"]) =>
    repository
      .getRun({ runId })
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError("PatchService.getRun", "Failed to load patch run.", cause),
        ),
      );

  const resolveRepoContext = (cwd: string) =>
    Effect.gen(function* () {
      const repoRoot = (yield* runGit("PatchService.resolveRepoContext.repoRoot", cwd, [
        "rev-parse",
        "--show-toplevel",
      ])).stdout.trim();
      const [branchResult, commitResult, remoteResult] = yield* Effect.all(
        [
          runGit(
            "PatchService.resolveRepoContext.branch",
            repoRoot,
            ["rev-parse", "--abbrev-ref", "HEAD"],
            true,
          ),
          runGit("PatchService.resolveRepoContext.commit", repoRoot, ["rev-parse", "HEAD"], true),
          runGit("PatchService.resolveRepoContext.remotes", repoRoot, ["remote", "-v"], true),
        ],
        { concurrency: "unbounded" },
      );

      const remotes = new Map<string, RemoteDescriptor>();
      for (const line of remoteResult.stdout.split(/\r?\n/g)) {
        const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
        if (!match || match[3] !== "fetch") continue;
        const [, name = "", url = ""] = match;
        remotes.set(name, {
          name,
          url,
          repository: parseGitRemoteRepository(url),
        });
      }

      return {
        repoRoot,
        currentBranch:
          branchResult.code === 0 && branchResult.stdout.trim() !== "HEAD"
            ? branchResult.stdout.trim()
            : null,
        currentCommit: commitResult.code === 0 ? commitResult.stdout.trim() : null,
        origin: remotes.get("origin") ?? null,
        upstream: remotes.get("upstream") ?? null,
      } satisfies RepoContext;
    });

  const readPatchProfile = (repoContext: RepoContext) =>
    Effect.gen(function* () {
      const patchPath = path.join(repoContext.repoRoot, PATCH_MARKDOWN_FILE);
      const exists = yield* fs.exists(patchPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return Option.none<PatchProfileType>();
      }

      const markdown = yield* fs
        .readFileString(patchPath)
        .pipe(
          Effect.mapError((cause) =>
            patchServiceError(
              "PatchService.readPatchProfile.readFile",
              `Failed to read ${patchPath}`,
              cause,
            ),
          ),
        );
      const parsed = yield* Effect.try({
        try: () => parsePatchMarkdown(markdown),
        catch: (cause) =>
          patchServiceError(
            "PatchService.readPatchProfile.parse",
            cause instanceof Error ? cause.message : "Failed to parse patch.md",
            cause,
          ),
      });

      const upstreamParts = splitRepositoryName(parsed.upstream);
      if (!upstreamParts) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.readPatchProfile.upstream",
            `Invalid upstream repository '${parsed.upstream}' in patch.md`,
          ),
        );
      }

      const existing = Option.getOrUndefined(yield* getProfileByRepoRoot(repoContext.repoRoot));
      const createdAt = existing?.createdAt ?? nowIso();
      const profileId = existing?.id ?? makeProfileId(repoContext.repoRoot);
      const updatedAt = nowIso();
      const profile: PatchProfileType = {
        id: profileId,
        repoRoot: repoContext.repoRoot,
        upstreamOwner: upstreamParts.owner,
        upstreamRepo: upstreamParts.repo,
        upstreamDefaultBranch: parsed.trackedBranch,
        trackedBranch: parsed.trackedBranch,
        upstreamRemoteName: "upstream",
        forkRemoteName: "origin",
        createdAt,
        updatedAt,
        baseCommit: parsed.baseCommit,
        patchStrategy: parsed.strategy,
        testCommands: parsed.testCommands,
        smokeCommands: parsed.smokeCommands,
        fallback: parsed.fallback,
        status: "ready",
        sourcePath: patchPath,
        sourceMarkdown: markdown.trim(),
        targets: parsed.patchTargets.map((target, index) => ({
          id: makeTargetId(profileId, index),
          profileId,
          area: target.area,
          intent: target.intent,
          pathGlobs: target.pathGlobs,
          notes: target.notes,
          priority: target.priority,
        })),
      };

      yield* upsertProfileRecord(profile);
      return Option.some(profile);
    });

  const readAheadBehind = (repoRoot: string, upstreamRef: string) =>
    Effect.gen(function* () {
      const result = yield* runGit(
        "PatchService.readAheadBehind",
        repoRoot,
        ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`],
        true,
      );
      const [aheadRaw = "0", behindRaw = "0"] = result.stdout.trim().split(/\s+/g);
      const aheadCount = Number.parseInt(aheadRaw, 10);
      const behindCount = Number.parseInt(behindRaw, 10);
      return {
        aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
        behindCount: Number.isFinite(behindCount) ? behindCount : 0,
      };
    });

  const readMergeBase = (repoRoot: string, upstreamRef: string) =>
    runGit("PatchService.readMergeBase", repoRoot, ["merge-base", "HEAD", upstreamRef], true).pipe(
      Effect.map((result) => (result.code === 0 ? result.stdout.trim() : null)),
    );

  const readPatchRunPointers = (profile: PatchProfileType | null) =>
    Effect.gen(function* () {
      if (!profile) {
        return {
          activeRun: null,
          lastRun: null,
        } satisfies { activeRun: PatchRunSummary | null; lastRun: PatchRunSummary | null };
      }
      const runs = yield* listRunsByProfileId(profile.id);
      return {
        activeRun: runs.find((run) => run.status === "reconciling") ?? null,
        lastRun: runs[0] ?? null,
      };
    });

  const buildStatus = (input: { cwd: string; profileOverride?: PatchProfileType | null }) =>
    Effect.gen(function* () {
      const repoContext = yield* resolveRepoContext(input.cwd);
      const profile =
        input.profileOverride !== undefined
          ? input.profileOverride
          : (Option.getOrUndefined(yield* readPatchProfile(repoContext)) ?? null);
      const trackedBranch = profile?.trackedBranch ?? "main";
      const upstreamRef = repoContext.upstream
        ? `${repoContext.upstream.name}/${trackedBranch}`
        : null;
      const aheadBehind =
        upstreamRef !== null
          ? yield* readAheadBehind(repoContext.repoRoot, upstreamRef)
          : { aheadCount: 0, behindCount: 0 };
      const mergeBaseCommit =
        upstreamRef !== null ? yield* readMergeBase(repoContext.repoRoot, upstreamRef) : null;
      const { activeRun, lastRun } = yield* readPatchRunPointers(profile);

      const statusState = buildStatusState({
        profile,
        behindCount: aheadBehind.behindCount,
        activeRun,
        lastRun,
      });

      return {
        state: statusState,
        repoRoot: repoContext.repoRoot,
        currentBranch: repoContext.currentBranch,
        currentCommit: repoContext.currentCommit,
        upstreamRemoteName: repoContext.upstream?.name ?? null,
        forkRemoteName: repoContext.origin?.name ?? null,
        upstreamRepository: repoContext.upstream?.repository ?? null,
        forkRepository: repoContext.origin?.repository ?? null,
        trackedBranch: profile?.trackedBranch ?? null,
        aheadCount: aheadBehind.aheadCount,
        behindCount: aheadBehind.behindCount,
        mergeBaseCommit,
        profile: profile ? toProfileSummary(profile) : null,
        activeRun,
        lastRun,
        canApply: lastRun?.status === "ready_for_review",
        message:
          !repoContext.upstream || !repoContext.origin
            ? "Configure both origin and upstream remotes for fork-aware patching."
            : lastRun
              ? summarizeRun(lastRun)
              : null,
      } satisfies PatchStatusResult;
    });

  const readCommitSubjects = (cwd: string, range: string) =>
    runGit("PatchService.readCommitSubjects", cwd, ["log", "--format=%h %s", range], true).pipe(
      Effect.map((result) => result.stdout.trim()),
    );

  const readDiffStat = (cwd: string, range: string) =>
    runGit("PatchService.readDiffStat", cwd, ["diff", "--stat", range], true).pipe(
      Effect.map((result) => result.stdout.trim()),
    );

  const buildReport = (input: {
    repoRoot: string;
    sandboxPath: string;
    mergeBaseCommit: string;
    upstreamRef: string;
    trackedBranch: string;
    replayedCommitCount: number;
    validationResults: ReadonlyArray<PatchValidationResult>;
    conflicts: ReadonlyArray<PatchConflict>;
  }) =>
    Effect.gen(function* () {
      const upstreamSummary = yield* readCommitSubjects(
        input.repoRoot,
        `${input.mergeBaseCommit}..${input.upstreamRef}`,
      );
      const forkSummary = yield* readCommitSubjects(
        input.repoRoot,
        `${input.mergeBaseCommit}..HEAD`,
      );
      const diffStat = yield* readDiffStat(input.sandboxPath, `${input.upstreamRef}...HEAD`);
      const validationSummary =
        input.validationResults.length === 0
          ? "No validation commands ran."
          : input.validationResults
              .map((result) => `- ${result.status.toUpperCase()}: ${result.command}`)
              .join("\n");
      const conflictSummary =
        input.conflicts.length === 0
          ? "No conflicts were recorded."
          : input.conflicts
              .map((conflict) => `- ${conflict.filePath}: ${conflict.summary}`)
              .join("\n");

      const summaryMarkdown = [
        "## Summary",
        `- Replayed ${input.replayedCommitCount} fork commit${input.replayedCommitCount === 1 ? "" : "s"} onto latest upstream ${input.trackedBranch}.`,
        `- Recorded ${input.conflicts.length} conflict${input.conflicts.length === 1 ? "" : "s"}.`,
        `- Ran ${input.validationResults.length} validation command${input.validationResults.length === 1 ? "" : "s"}.`,
        "",
        "## Upstream",
        upstreamSummary || "No upstream commits detected.",
        "",
        "## Fork",
        forkSummary || "No fork-only commits detected.",
        "",
        "## Validation",
        validationSummary,
        "",
        "## Conflicts",
        conflictSummary,
      ].join("\n");

      return {
        summaryMarkdown,
        upstreamSummary,
        forkSummary,
        diffStat,
      } satisfies PatchReport;
    });

  const persistRun = (run: PatchRun) =>
    repository
      .upsertRun(run)
      .pipe(
        Effect.mapError((cause) =>
          patchServiceError("PatchService.persistRun", "Failed to persist patch run.", cause),
        ),
      );

  const collectConflicts = (sandboxPath: string, runId: PatchRun["id"]) =>
    Effect.gen(function* () {
      const status = yield* runGit(
        "PatchService.collectConflicts",
        sandboxPath,
        ["status", "--porcelain"],
        true,
      );
      const conflicts: PatchConflict[] = [];
      for (const line of status.stdout.split(/\r?\n/g)) {
        if (line.trim().length === 0) continue;
        const code = line.slice(0, 2);
        const filePath = line.slice(3).trim();
        if (filePath.length === 0) continue;
        if (!["UU", "AA", "AU", "UA", "UD", "DU", "DD"].includes(code)) continue;
        conflicts.push({
          id: makeConflictId(runId, filePath),
          patchRunId: runId,
          filePath,
          conflictKind: classifyConflict(code),
          resolver: "manual",
          confidence: 0,
          summary: `Git reported unresolved conflict state ${code}.`,
          resolved: false,
        });
      }
      return conflicts;
    });

  const runValidation = (
    run: PatchRun,
    profile: PatchProfileType,
  ): Effect.Effect<ValidationExecutionResult, PatchServiceError> =>
    Effect.gen(function* () {
      const results: PatchValidationResult[] = [];
      const logs: PatchLogEntry[] = [];
      let failed = false;

      const commands = buildValidationCommands(profile);
      for (const [index, command] of commands.entries()) {
        logs.push(makeLogEntry(run.id, "info", `Running validation command: ${command}`));
        const startedAt = nowIso();
        const processResult = yield* Effect.tryPromise({
          try: () =>
            runProcess("bash", ["-lc", command], {
              cwd: run.sandboxWorktreePath,
              timeoutMs: 20 * 60_000,
              allowNonZeroExit: true,
              outputMode: "truncate",
            }),
          catch: (cause) =>
            patchServiceError(
              "PatchService.runValidation.exec",
              `Failed to execute validation command '${command}'.`,
              cause,
            ),
        });
        const outputExcerpt = [processResult.stdout.trim(), processResult.stderr.trim()]
          .filter((value) => value.length > 0)
          .join("\n\n")
          .slice(0, 4_000);
        const passed = !processResult.timedOut && processResult.code === 0;
        const result: PatchValidationResult = {
          id: makeValidationResultId(run.id, command, index),
          patchRunId: run.id,
          command,
          exitCode: processResult.code,
          outputExcerpt,
          status: passed ? "passed" : "failed",
          startedAt,
          finishedAt: nowIso(),
        };
        results.push(result);
        if (!passed) {
          failed = true;
          logs.push(
            makeLogEntry(
              run.id,
              "error",
              `Validation command failed (${processResult.code ?? "null"}): ${command}`,
            ),
          );
          break;
        }
      }

      return { results, logs, failed };
    });

  const status: PatchServiceShape["status"] = (input) => buildStatus({ cwd: input.cwd });

  const generateProfile: PatchServiceShape["generateProfile"] = (input) =>
    Effect.gen(function* () {
      const repoContext = yield* resolveRepoContext(input.cwd);
      if (!repoContext.origin || !repoContext.upstream) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.generateProfile.remotes",
            "Patch profile generation requires both origin and upstream remotes.",
          ),
        );
      }

      const upstreamRepository = repoContext.upstream.repository;
      if (!upstreamRepository) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.generateProfile.upstream",
            `Unable to determine upstream GitHub repository from '${repoContext.upstream.url}'.`,
          ),
        );
      }
      const upstreamParts = splitRepositoryName(upstreamRepository);
      if (!upstreamParts) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.generateProfile.upstream",
            `Unable to determine upstream GitHub repository from '${repoContext.upstream.url}'.`,
          ),
        );
      }

      const trackedBranch = input.trackedBranch ?? "main";
      const normalizedTargets = normalizeGenerateProfileTargets(input.targets);
      const patchMarkdown = serializePatchMarkdown(
        normalizePatchMarkdownInput({
          upstream: upstreamRepository,
          trackedBranch,
          strategy: input.strategy ?? "commit-stack",
          baseCommit: repoContext.currentCommit ?? "HEAD",
          testCommands: input.testCommands ?? Array.from(DEFAULT_TEST_COMMANDS),
          smokeCommands: input.smokeCommands ?? [],
          ...(normalizedTargets ? { targets: normalizedTargets } : {}),
        }),
      );
      const patchPath = path.join(repoContext.repoRoot, PATCH_MARKDOWN_FILE);
      yield* fs
        .writeFileString(patchPath, patchMarkdown)
        .pipe(
          Effect.mapError((cause) =>
            patchServiceError(
              "PatchService.generateProfile.writeFile",
              `Failed to write ${patchPath}.`,
              cause,
            ),
          ),
        );
      const profileOption = yield* readPatchProfile(repoContext);
      const profile = Option.getOrUndefined(profileOption);
      if (!profile) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.generateProfile.profile",
            "Patch profile could not be reloaded after generation.",
          ),
        );
      }
      const updatedProfile: PatchProfileType = {
        ...profile,
        upstreamOwner: upstreamParts.owner,
        upstreamRepo: upstreamParts.repo,
        upstreamDefaultBranch: trackedBranch,
        trackedBranch,
        upstreamRemoteName: repoContext.upstream.name,
        forkRemoteName: repoContext.origin.name,
      };
      yield* upsertProfileRecord(updatedProfile);
      const nextStatus = yield* buildStatus({
        cwd: repoContext.repoRoot,
        profileOverride: updatedProfile,
      });
      return {
        profile: updatedProfile,
        status: nextStatus,
      };
    });

  const reconcile: PatchServiceShape["reconcile"] = (input, options) =>
    Effect.gen(function* () {
      const publisher = options?.eventPublisher;
      const repoContext = yield* resolveRepoContext(input.cwd);
      if (!repoContext.upstream || !repoContext.origin) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.reconcile.remotes",
            "Patch reconciliation requires both origin and upstream remotes.",
          ),
        );
      }

      const profileOption = yield* readPatchProfile(repoContext);
      const profile = Option.getOrUndefined(profileOption);
      if (!profile) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.reconcile.profile",
            "Patch profile is missing. Generate patch.md before reconciling.",
          ),
        );
      }
      const upstreamRef = `${repoContext.upstream.name}/${profile.trackedBranch}`;
      const mergeBaseCommit = yield* readMergeBase(repoContext.repoRoot, upstreamRef);
      if (!mergeBaseCommit) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.reconcile.mergeBase",
            `Unable to compute merge base against ${upstreamRef}.`,
          ),
        );
      }

      const fetchResult = yield* runGit(
        "PatchService.reconcile.fetch",
        repoContext.repoRoot,
        ["fetch", repoContext.upstream.name, profile.trackedBranch],
        true,
      );
      if (fetchResult.code !== 0) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.reconcile.fetch",
            fetchResult.stderr.trim() || `Failed to fetch ${upstreamRef}.`,
          ),
        );
      }

      const upstreamCommit = (yield* runGit(
        "PatchService.reconcile.upstreamCommit",
        repoContext.repoRoot,
        ["rev-parse", upstreamRef],
      )).stdout.trim();
      const commitStackText = (yield* runGit(
        "PatchService.reconcile.commitStack",
        repoContext.repoRoot,
        ["rev-list", "--reverse", `${mergeBaseCommit}..HEAD`],
        true,
      )).stdout.trim();
      const commitStack = commitStackText.length > 0 ? commitStackText.split(/\r?\n/g) : [];

      const sandboxBranch = `patch/sandbox/${randomUUID()}`;
      const sandboxPath = path.join(
        serverConfig.worktreesDir,
        path.basename(repoContext.repoRoot),
        "patch-runs",
        sandboxBranch.replace(/\//g, "-"),
      );
      const startedAt = nowIso();
      let run: PatchRun = {
        id: makeRunId(),
        profileId: profile.id,
        upstreamFromCommit: mergeBaseCommit,
        upstreamToCommit: upstreamCommit,
        forkHeadBefore: repoContext.currentCommit ?? mergeBaseCommit,
        sandboxBranch,
        sandboxWorktreePath: sandboxPath,
        applyBranch: null,
        status: "reconciling",
        confidenceScore: 0,
        summary: "Reconciling patch stack against upstream.",
        report: {
          summaryMarkdown: "",
          upstreamSummary: "",
          forkSummary: "",
          diffStat: "",
        },
        startedAt,
        finishedAt: null,
        conflicts: [],
        validationResults: [],
        logs: [],
      };
      run = {
        ...run,
        logs: [makeLogEntry(run.id, "info", "Started patch reconciliation.")],
      };
      yield* persistRun(run);
      yield* emit(publisher, {
        kind: "run_started",
        runId: run.id,
        cwd: repoContext.repoRoot,
        createdAt: nowIso(),
        status: run.status,
        message: "Patch reconciliation started.",
      });

      const worktreeResult = yield* git
        .createWorktree({
          cwd: repoContext.repoRoot,
          branch: upstreamRef,
          newBranch: sandboxBranch,
          path: sandboxPath,
        })
        .pipe(
          Effect.mapError((cause) =>
            patchServiceError(
              "PatchService.reconcile.createWorktree",
              "Failed to create sandbox worktree.",
              cause,
            ),
          ),
        );
      run = {
        ...run,
        sandboxWorktreePath: worktreeResult.worktree.path,
        logs: [
          ...run.logs,
          makeLogEntry(
            run.id,
            "info",
            `Created sandbox worktree at ${worktreeResult.worktree.path}.`,
          ),
        ],
      };
      yield* persistRun(run);
      yield* emit(publisher, {
        kind: "run_progress",
        runId: run.id,
        cwd: repoContext.repoRoot,
        createdAt: nowIso(),
        phase: "sandbox",
        message: `Created sandbox worktree at ${worktreeResult.worktree.path}.`,
      });

      for (const commit of commitStack) {
        const parentInfo = (yield* runGit(
          "PatchService.reconcile.commitParents",
          repoContext.repoRoot,
          ["rev-list", "--parents", "-n", "1", commit],
        )).stdout.trim();
        if (parentInfo.split(/\s+/g).length > 2) {
          run = {
            ...run,
            status: "failed",
            finishedAt: nowIso(),
            summary: `Merge commit ${commit} requires manual investigation.`,
            logs: [
              ...run.logs,
              makeLogEntry(
                run.id,
                "error",
                `Encountered merge commit ${commit}; automatic replay stops here.`,
              ),
            ],
          };
          const report = yield* buildReport({
            repoRoot: repoContext.repoRoot,
            sandboxPath: run.sandboxWorktreePath,
            mergeBaseCommit,
            upstreamRef,
            trackedBranch: profile.trackedBranch,
            replayedCommitCount: 0,
            validationResults: [],
            conflicts: [],
          });
          run = {
            ...run,
            report,
          };
          yield* persistRun(run);
          yield* emit(publisher, {
            kind: "run_failed",
            runId: run.id,
            cwd: repoContext.repoRoot,
            createdAt: nowIso(),
            status: run.status,
            message: run.summary,
          });
          return run;
        }

        yield* emit(publisher, {
          kind: "run_progress",
          runId: run.id,
          cwd: repoContext.repoRoot,
          createdAt: nowIso(),
          phase: "replay",
          message: `Cherry-picking ${commit}.`,
        });
        const cherryPick = yield* runGit(
          "PatchService.reconcile.cherryPick",
          run.sandboxWorktreePath,
          ["cherry-pick", "--allow-empty", commit],
          true,
        );
        if (cherryPick.code !== 0) {
          const conflicts = yield* collectConflicts(run.sandboxWorktreePath, run.id);
          const logs = [
            ...run.logs,
            makeLogEntry(
              run.id,
              "error",
              cherryPick.stderr.trim() || `Cherry-pick failed for commit ${commit}.`,
            ),
          ];
          run = {
            ...run,
            status: "conflicted",
            finishedAt: nowIso(),
            summary: `Cherry-pick stopped on ${commit} with ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}.`,
            conflicts,
            logs,
          };
          const report = yield* buildReport({
            repoRoot: repoContext.repoRoot,
            sandboxPath: run.sandboxWorktreePath,
            mergeBaseCommit,
            upstreamRef,
            trackedBranch: profile.trackedBranch,
            replayedCommitCount: commitStack.indexOf(commit),
            validationResults: [],
            conflicts,
          });
          run = {
            ...run,
            report,
          };
          yield* persistRun(run);
          for (const conflict of conflicts) {
            yield* emit(publisher, {
              kind: "conflict_detected",
              runId: run.id,
              cwd: repoContext.repoRoot,
              createdAt: nowIso(),
              conflict,
            });
          }
          yield* emit(publisher, {
            kind: "run_finished",
            runId: run.id,
            cwd: repoContext.repoRoot,
            createdAt: nowIso(),
            status: run.status,
            summary: run.summary,
          });
          return run;
        }
      }

      const validation = yield* runValidation(run, profile);
      run = {
        ...run,
        validationResults: validation.results,
        logs: [...run.logs, ...validation.logs],
      };
      for (const result of validation.results) {
        yield* emit(publisher, {
          kind: "validation_completed",
          runId: run.id,
          cwd: repoContext.repoRoot,
          createdAt: nowIso(),
          result,
        });
      }

      run = {
        ...run,
        status: validation.failed ? "validation_failed" : "ready_for_review",
        finishedAt: nowIso(),
        confidenceScore: validation.failed ? 40 : 100,
        summary: validation.failed
          ? "Patch replay completed, but validation failed."
          : "Patch replay and validation completed successfully.",
      };
      const report = yield* buildReport({
        repoRoot: repoContext.repoRoot,
        sandboxPath: run.sandboxWorktreePath,
        mergeBaseCommit,
        upstreamRef,
        trackedBranch: profile.trackedBranch,
        replayedCommitCount: commitStack.length,
        validationResults: run.validationResults,
        conflicts: run.conflicts,
      });
      run = {
        ...run,
        report,
        logs: [
          ...run.logs,
          makeLogEntry(run.id, validation.failed ? "error" : "info", run.summary),
        ],
      };
      yield* persistRun(run);
      yield* emit(publisher, {
        kind: "run_finished",
        runId: run.id,
        cwd: repoContext.repoRoot,
        createdAt: nowIso(),
        status: run.status,
        summary: run.summary,
      });
      return run;
    });

  const getRun: PatchServiceShape["getRun"] = (input) =>
    getRunOption(input.runId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              patchServiceError("PatchService.getRun", `Patch run '${input.runId}' was not found.`),
            ),
          onSome: (run) => Effect.succeed(run),
        }),
      ),
    );

  const apply: PatchServiceShape["apply"] = (input, options) =>
    Effect.gen(function* () {
      const publisher = options?.eventPublisher;
      const run = yield* getRun(input);
      const profileOption = yield* getProfileById(run.profileId);
      const profile = Option.getOrUndefined(profileOption);
      if (!profile) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.apply.profile",
            `Patch profile '${run.profileId}' was not found.`,
          ),
        );
      }
      if (run.status !== "ready_for_review") {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.apply.status",
            `Patch run '${run.id}' is not ready to apply.`,
          ),
        );
      }

      const sandboxHead = (yield* runGit(
        "PatchService.apply.sandboxHead",
        run.sandboxWorktreePath,
        ["rev-parse", "HEAD"],
      )).stdout.trim();
      const applyBranch = `patch/apply/${run.id}`;
      const branchExists = yield* runGit(
        "PatchService.apply.branchExists",
        profile.repoRoot,
        ["rev-parse", "--verify", applyBranch],
        true,
      );
      if (branchExists.code === 0) {
        yield* runGit("PatchService.apply.resetExistingBranch", profile.repoRoot, [
          "branch",
          "--force",
          applyBranch,
          sandboxHead,
        ]);
      } else {
        yield* runGit("PatchService.apply.createBranch", profile.repoRoot, [
          "branch",
          applyBranch,
          sandboxHead,
        ]);
      }

      const statusDetails = yield* git
        .statusDetails(profile.repoRoot)
        .pipe(
          Effect.mapError((cause) =>
            patchServiceError(
              "PatchService.apply.statusDetails",
              "Failed to inspect working tree before apply.",
              cause,
            ),
          ),
        );
      const currentHead = (yield* runGit(
        "PatchService.apply.currentHead",
        profile.repoRoot,
        ["rev-parse", "HEAD"],
        true,
      )).stdout.trim();
      const checkedOut = !statusDetails.hasWorkingTreeChanges && currentHead === run.forkHeadBefore;
      if (checkedOut) {
        yield* Effect.scoped(
          git
            .checkoutBranch({ cwd: profile.repoRoot, branch: applyBranch })
            .pipe(
              Effect.mapError((cause) =>
                patchServiceError(
                  "PatchService.apply.checkout",
                  "Failed to checkout apply branch.",
                  cause,
                ),
              ),
            ),
        );
      }

      const nextRun: PatchRun = {
        ...run,
        applyBranch,
        status: "applied",
        logs: [
          ...run.logs,
          makeLogEntry(
            run.id,
            "info",
            `Created apply branch ${applyBranch}${checkedOut ? " and checked it out." : "."}`,
          ),
        ],
      };
      yield* persistRun(nextRun);
      yield* emit(publisher, {
        kind: "apply_completed",
        runId: nextRun.id,
        cwd: profile.repoRoot,
        createdAt: nowIso(),
        applyBranch,
        checkedOut,
      });
      return {
        run: nextRun,
        applyBranch,
        checkedOut,
      };
    });

  const openSandbox: PatchServiceShape["openSandbox"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRun(input);
      return { path: run.sandboxWorktreePath };
    });

  const discardRun: PatchServiceShape["discardRun"] = (input, options) =>
    Effect.gen(function* () {
      const publisher = options?.eventPublisher;
      const run = yield* getRun(input);
      const profileOption = yield* getProfileById(run.profileId);
      const profile = Option.getOrUndefined(profileOption);
      if (!profile) {
        return yield* Effect.fail(
          patchServiceError(
            "PatchService.discardRun.profile",
            `Patch profile '${run.profileId}' was not found.`,
          ),
        );
      }

      const sandboxExists = yield* fs
        .exists(run.sandboxWorktreePath)
        .pipe(Effect.orElseSucceed(() => false));
      if (sandboxExists) {
        yield* git
          .removeWorktree({
            cwd: profile.repoRoot,
            path: run.sandboxWorktreePath,
            force: true,
          })
          .pipe(
            Effect.mapError((cause) =>
              patchServiceError(
                "PatchService.discardRun.removeWorktree",
                "Failed to remove sandbox worktree.",
                cause,
              ),
            ),
          );
      }

      const nextRun: PatchRun = {
        ...run,
        status: "discarded",
        finishedAt: run.finishedAt ?? nowIso(),
        logs: [
          ...run.logs,
          makeLogEntry(run.id, "info", "Discarded patch run and removed sandbox worktree."),
        ],
      };
      yield* persistRun(nextRun);
      yield* emit(publisher, {
        kind: "run_discarded",
        runId: nextRun.id,
        cwd: profile.repoRoot,
        createdAt: nowIso(),
        message: "Patch run discarded.",
      });
      return { run: nextRun };
    });

  return {
    status,
    generateProfile,
    reconcile,
    getRun,
    apply,
    openSandbox,
    discardRun,
  } satisfies PatchServiceShape;
});

export const PatchServiceLive = Layer.effect(PatchService, makePatchService);
