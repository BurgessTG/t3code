import {
  PatchConflict,
  PatchLogEntry,
  PatchProfile,
  PatchReport,
  PatchRun,
  PatchRunSummary,
  PatchTarget,
  PatchValidationResult,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../Errors.ts";
import { PatchRepository, type PatchRepositoryShape } from "../Services/PatchRepository.ts";

const StringArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));
const PatchReportJson = Schema.fromJsonString(PatchReport);

interface PatchProfileRow {
  profile_id: string;
  repo_root: string;
  upstream_owner: string;
  upstream_repo: string;
  upstream_default_branch: string;
  tracked_branch: string;
  upstream_remote_name: string;
  fork_remote_name: string;
  created_at: string;
  updated_at: string;
  base_commit: string;
  patch_strategy: string;
  test_commands_json: string;
  smoke_commands_json: string;
  fallback_mode: string;
  status: string;
  source_path: string;
  source_markdown: string;
}

interface PatchTargetRow {
  target_id: string;
  profile_id: string;
  area: string;
  intent: string;
  path_globs_json: string;
  notes: string | null;
  priority: number;
}

interface PatchRunRow {
  run_id: string;
  profile_id: string;
  upstream_from_commit: string;
  upstream_to_commit: string;
  fork_head_before: string;
  sandbox_branch: string;
  sandbox_worktree_path: string;
  apply_branch: string | null;
  status: string;
  confidence_score: number;
  summary: string;
  report_json: string;
  started_at: string;
  finished_at: string | null;
}

interface PatchConflictRow {
  conflict_id: string;
  patch_run_id: string;
  file_path: string;
  conflict_kind: string;
  resolver: string;
  confidence: number;
  summary: string;
  resolved: number;
}

interface PatchValidationResultRow {
  validation_result_id: string;
  patch_run_id: string;
  command: string;
  exit_code: number | null;
  output_excerpt: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

interface PatchLogRow {
  log_id: string;
  patch_run_id: string;
  level: string;
  message: string;
  created_at: string;
}

function decodeSchema<T>(operation: string, schema: Schema.Schema<T>, value: unknown) {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as never)(value) as T,
    catch: (cause): ProjectionRepositoryError =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError(operation)(cause)
        : toPersistenceSqlError(operation)(cause),
  });
}

const decodePatchTarget = (row: PatchTargetRow) =>
  Effect.gen(function* () {
    const pathGlobs = yield* decodeSchema(
      "PatchRepository.decodePatchTarget:pathGlobs",
      StringArrayJson,
      row.path_globs_json,
    );

    return yield* decodeSchema("PatchRepository.decodePatchTarget", PatchTarget, {
      id: row.target_id,
      profileId: row.profile_id,
      area: row.area,
      intent: row.intent,
      pathGlobs,
      notes: row.notes,
      priority: row.priority,
    });
  });

const decodePatchProfile = (row: PatchProfileRow, targets: ReadonlyArray<PatchTarget>) =>
  Effect.gen(function* () {
    const testCommands = yield* decodeSchema(
      "PatchRepository.decodePatchProfile:testCommands",
      StringArrayJson,
      row.test_commands_json,
    );
    const smokeCommands = yield* decodeSchema(
      "PatchRepository.decodePatchProfile:smokeCommands",
      StringArrayJson,
      row.smoke_commands_json,
    );

    return yield* decodeSchema("PatchRepository.decodePatchProfile", PatchProfile, {
      id: row.profile_id,
      repoRoot: row.repo_root,
      upstreamOwner: row.upstream_owner,
      upstreamRepo: row.upstream_repo,
      upstreamDefaultBranch: row.upstream_default_branch,
      trackedBranch: row.tracked_branch,
      upstreamRemoteName: row.upstream_remote_name,
      forkRemoteName: row.fork_remote_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      baseCommit: row.base_commit,
      patchStrategy: row.patch_strategy,
      testCommands,
      smokeCommands,
      fallback: row.fallback_mode,
      status: row.status,
      sourcePath: row.source_path,
      sourceMarkdown: row.source_markdown,
      targets,
    });
  });

const decodePatchRunSummary = (row: PatchRunRow) =>
  Effect.gen(function* () {
    const report = yield* decodeSchema(
      "PatchRepository.decodePatchRunSummary:report",
      PatchReportJson,
      row.report_json,
    );

    return yield* decodeSchema("PatchRepository.decodePatchRunSummary", PatchRunSummary, {
      id: row.run_id,
      profileId: row.profile_id,
      upstreamFromCommit: row.upstream_from_commit,
      upstreamToCommit: row.upstream_to_commit,
      forkHeadBefore: row.fork_head_before,
      sandboxBranch: row.sandbox_branch,
      sandboxWorktreePath: row.sandbox_worktree_path,
      applyBranch: row.apply_branch,
      status: row.status,
      confidenceScore: row.confidence_score,
      summary: row.summary,
      report,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    });
  });

const decodePatchConflict = (row: PatchConflictRow) =>
  decodeSchema("PatchRepository.decodePatchConflict", PatchConflict, {
    id: row.conflict_id,
    patchRunId: row.patch_run_id,
    filePath: row.file_path,
    conflictKind: row.conflict_kind,
    resolver: row.resolver,
    confidence: row.confidence,
    summary: row.summary,
    resolved: row.resolved !== 0,
  });

const decodePatchValidationResult = (row: PatchValidationResultRow) =>
  decodeSchema("PatchRepository.decodePatchValidationResult", PatchValidationResult, {
    id: row.validation_result_id,
    patchRunId: row.patch_run_id,
    command: row.command,
    exitCode: row.exit_code,
    outputExcerpt: row.output_excerpt,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });

const decodePatchLogEntry = (row: PatchLogRow) =>
  decodeSchema("PatchRepository.decodePatchLogEntry", PatchLogEntry, {
    id: row.log_id,
    patchRunId: row.patch_run_id,
    level: row.level,
    message: row.message,
    createdAt: row.created_at,
  });

const makePatchRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const loadTargets = (profileId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<PatchTargetRow>`
        SELECT
          target_id,
          profile_id,
          area,
          intent,
          path_globs_json,
          notes,
          priority
        FROM patch_targets
        WHERE profile_id = ${profileId}
        ORDER BY priority DESC, target_id ASC
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.loadTargets:query")));

      return yield* Effect.forEach(rows, decodePatchTarget, { concurrency: "unbounded" });
    });

  const loadRunAggregate = (runRow: PatchRunRow) =>
    Effect.gen(function* () {
      const [summary, conflictRows, validationRows, logRows] = yield* Effect.all(
        [
          decodePatchRunSummary(runRow),
          sql<PatchConflictRow>`
            SELECT
              conflict_id,
              patch_run_id,
              file_path,
              conflict_kind,
              resolver,
              confidence,
              summary,
              resolved
            FROM patch_conflicts
            WHERE patch_run_id = ${runRow.run_id}
            ORDER BY file_path ASC, conflict_id ASC
          `.pipe(
            Effect.mapError(toPersistenceSqlError("PatchRepository.loadRunAggregate:conflicts")),
          ),
          sql<PatchValidationResultRow>`
            SELECT
              validation_result_id,
              patch_run_id,
              command,
              exit_code,
              output_excerpt,
              status,
              started_at,
              finished_at
            FROM patch_validation_results
            WHERE patch_run_id = ${runRow.run_id}
            ORDER BY started_at ASC, validation_result_id ASC
          `.pipe(
            Effect.mapError(toPersistenceSqlError("PatchRepository.loadRunAggregate:validation")),
          ),
          sql<PatchLogRow>`
            SELECT
              log_id,
              patch_run_id,
              level,
              message,
              created_at
            FROM patch_logs
            WHERE patch_run_id = ${runRow.run_id}
            ORDER BY created_at ASC, log_id ASC
          `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.loadRunAggregate:logs"))),
        ],
        { concurrency: "unbounded" },
      );

      const [conflicts, validationResults, logs] = yield* Effect.all(
        [
          Effect.forEach(conflictRows, decodePatchConflict, { concurrency: "unbounded" }),
          Effect.forEach(validationRows, decodePatchValidationResult, {
            concurrency: "unbounded",
          }),
          Effect.forEach(logRows, decodePatchLogEntry, { concurrency: "unbounded" }),
        ],
        { concurrency: "unbounded" },
      );

      return yield* decodeSchema("PatchRepository.loadRunAggregate", PatchRun, {
        ...summary,
        conflicts,
        validationResults,
        logs,
      });
    });

  const upsertProfile: PatchRepositoryShape["upsertProfile"] = (profile) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO patch_profiles (
              profile_id,
              repo_root,
              upstream_owner,
              upstream_repo,
              upstream_default_branch,
              tracked_branch,
              upstream_remote_name,
              fork_remote_name,
              created_at,
              updated_at,
              base_commit,
              patch_strategy,
              test_commands_json,
              smoke_commands_json,
              fallback_mode,
              status,
              source_path,
              source_markdown
            )
            VALUES (
              ${profile.id},
              ${profile.repoRoot},
              ${profile.upstreamOwner},
              ${profile.upstreamRepo},
              ${profile.upstreamDefaultBranch},
              ${profile.trackedBranch},
              ${profile.upstreamRemoteName},
              ${profile.forkRemoteName},
              ${profile.createdAt},
              ${profile.updatedAt},
              ${profile.baseCommit},
              ${profile.patchStrategy},
              ${JSON.stringify(profile.testCommands)},
              ${JSON.stringify(profile.smokeCommands)},
              ${profile.fallback},
              ${profile.status},
              ${profile.sourcePath},
              ${profile.sourceMarkdown}
            )
            ON CONFLICT (profile_id)
            DO UPDATE SET
              repo_root = excluded.repo_root,
              upstream_owner = excluded.upstream_owner,
              upstream_repo = excluded.upstream_repo,
              upstream_default_branch = excluded.upstream_default_branch,
              tracked_branch = excluded.tracked_branch,
              upstream_remote_name = excluded.upstream_remote_name,
              fork_remote_name = excluded.fork_remote_name,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              base_commit = excluded.base_commit,
              patch_strategy = excluded.patch_strategy,
              test_commands_json = excluded.test_commands_json,
              smoke_commands_json = excluded.smoke_commands_json,
              fallback_mode = excluded.fallback_mode,
              status = excluded.status,
              source_path = excluded.source_path,
              source_markdown = excluded.source_markdown
          `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertProfile:profile")));

          yield* sql`
            DELETE FROM patch_targets
            WHERE profile_id = ${profile.id}
          `.pipe(
            Effect.mapError(toPersistenceSqlError("PatchRepository.upsertProfile:clearTargets")),
          );

          yield* Effect.forEach(profile.targets, (target) =>
            sql`
              INSERT INTO patch_targets (
                target_id,
                profile_id,
                area,
                intent,
                path_globs_json,
                notes,
                priority
              )
              VALUES (
                ${target.id},
                ${target.profileId},
                ${target.area},
                ${target.intent},
                ${JSON.stringify(target.pathGlobs)},
                ${target.notes},
                ${target.priority}
              )
            `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertProfile:target"))),
          );
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertProfile:transaction")));

  const getProfileByRepoRoot: PatchRepositoryShape["getProfileByRepoRoot"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<PatchProfileRow>`
        SELECT
          profile_id,
          repo_root,
          upstream_owner,
          upstream_repo,
          upstream_default_branch,
          tracked_branch,
          upstream_remote_name,
          fork_remote_name,
          created_at,
          updated_at,
          base_commit,
          patch_strategy,
          test_commands_json,
          smoke_commands_json,
          fallback_mode,
          status,
          source_path,
          source_markdown
        FROM patch_profiles
        WHERE repo_root = ${input.repoRoot}
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.getProfileByRepoRoot:query")));

      const row = rows[0];
      if (!row) return Option.none();
      const targets = yield* loadTargets(row.profile_id);
      return Option.some(yield* decodePatchProfile(row, targets));
    });

  const getProfileById: PatchRepositoryShape["getProfileById"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<PatchProfileRow>`
        SELECT
          profile_id,
          repo_root,
          upstream_owner,
          upstream_repo,
          upstream_default_branch,
          tracked_branch,
          upstream_remote_name,
          fork_remote_name,
          created_at,
          updated_at,
          base_commit,
          patch_strategy,
          test_commands_json,
          smoke_commands_json,
          fallback_mode,
          status,
          source_path,
          source_markdown
        FROM patch_profiles
        WHERE profile_id = ${input.profileId}
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.getProfileById:query")));

      const row = rows[0];
      if (!row) return Option.none();
      const targets = yield* loadTargets(row.profile_id);
      return Option.some(yield* decodePatchProfile(row, targets));
    });

  const upsertRun: PatchRepositoryShape["upsertRun"] = (run) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO patch_runs (
              run_id,
              profile_id,
              upstream_from_commit,
              upstream_to_commit,
              fork_head_before,
              sandbox_branch,
              sandbox_worktree_path,
              apply_branch,
              status,
              confidence_score,
              summary,
              report_json,
              started_at,
              finished_at
            )
            VALUES (
              ${run.id},
              ${run.profileId},
              ${run.upstreamFromCommit},
              ${run.upstreamToCommit},
              ${run.forkHeadBefore},
              ${run.sandboxBranch},
              ${run.sandboxWorktreePath},
              ${run.applyBranch},
              ${run.status},
              ${run.confidenceScore},
              ${run.summary},
              ${JSON.stringify(run.report)},
              ${run.startedAt},
              ${run.finishedAt}
            )
            ON CONFLICT (run_id)
            DO UPDATE SET
              profile_id = excluded.profile_id,
              upstream_from_commit = excluded.upstream_from_commit,
              upstream_to_commit = excluded.upstream_to_commit,
              fork_head_before = excluded.fork_head_before,
              sandbox_branch = excluded.sandbox_branch,
              sandbox_worktree_path = excluded.sandbox_worktree_path,
              apply_branch = excluded.apply_branch,
              status = excluded.status,
              confidence_score = excluded.confidence_score,
              summary = excluded.summary,
              report_json = excluded.report_json,
              started_at = excluded.started_at,
              finished_at = excluded.finished_at
          `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:run")));

          yield* sql`
            DELETE FROM patch_conflicts
            WHERE patch_run_id = ${run.id}
          `.pipe(
            Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:clearConflicts")),
          );
          yield* sql`
            DELETE FROM patch_validation_results
            WHERE patch_run_id = ${run.id}
          `.pipe(
            Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:clearValidation")),
          );
          yield* sql`
            DELETE FROM patch_logs
            WHERE patch_run_id = ${run.id}
          `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:clearLogs")));

          yield* Effect.forEach(run.conflicts, (conflict) =>
            sql`
              INSERT INTO patch_conflicts (
                conflict_id,
                patch_run_id,
                file_path,
                conflict_kind,
                resolver,
                confidence,
                summary,
                resolved
              )
              VALUES (
                ${conflict.id},
                ${conflict.patchRunId},
                ${conflict.filePath},
                ${conflict.conflictKind},
                ${conflict.resolver},
                ${conflict.confidence},
                ${conflict.summary},
                ${conflict.resolved ? 1 : 0}
              )
            `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:conflict"))),
          );

          yield* Effect.forEach(run.validationResults, (result) =>
            sql`
              INSERT INTO patch_validation_results (
                validation_result_id,
                patch_run_id,
                command,
                exit_code,
                output_excerpt,
                status,
                started_at,
                finished_at
              )
              VALUES (
                ${result.id},
                ${result.patchRunId},
                ${result.command},
                ${result.exitCode},
                ${result.outputExcerpt},
                ${result.status},
                ${result.startedAt},
                ${result.finishedAt}
              )
            `.pipe(
              Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:validationResult")),
            ),
          );

          yield* Effect.forEach(run.logs, (log) =>
            sql`
              INSERT INTO patch_logs (
                log_id,
                patch_run_id,
                level,
                message,
                created_at
              )
              VALUES (
                ${log.id},
                ${log.patchRunId},
                ${log.level},
                ${log.message},
                ${log.createdAt}
              )
            `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:log"))),
          );
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.upsertRun:transaction")));

  const getRun: PatchRepositoryShape["getRun"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<PatchRunRow>`
        SELECT
          run_id,
          profile_id,
          upstream_from_commit,
          upstream_to_commit,
          fork_head_before,
          sandbox_branch,
          sandbox_worktree_path,
          apply_branch,
          status,
          confidence_score,
          summary,
          report_json,
          started_at,
          finished_at
        FROM patch_runs
        WHERE run_id = ${input.runId}
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.getRun:query")));

      const row = rows[0];
      if (!row) return Option.none();
      return Option.some(yield* loadRunAggregate(row));
    });

  const listRuns: PatchRepositoryShape["listRuns"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<PatchRunRow>`
        SELECT
          run_id,
          profile_id,
          upstream_from_commit,
          upstream_to_commit,
          fork_head_before,
          sandbox_branch,
          sandbox_worktree_path,
          apply_branch,
          status,
          confidence_score,
          summary,
          report_json,
          started_at,
          finished_at
        FROM patch_runs
        WHERE profile_id = ${input.profileId}
        ORDER BY started_at DESC, run_id DESC
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.listRuns:query")));

      return yield* Effect.forEach(rows, decodePatchRunSummary, { concurrency: "unbounded" });
    });

  const appendLogs: PatchRepositoryShape["appendLogs"] = (runId, logs) =>
    Effect.forEach(logs, (log) =>
      sql`
        INSERT INTO patch_logs (
          log_id,
          patch_run_id,
          level,
          message,
          created_at
        )
        VALUES (
          ${log.id},
          ${runId},
          ${log.level},
          ${log.message},
          ${log.createdAt}
        )
      `.pipe(Effect.mapError(toPersistenceSqlError("PatchRepository.appendLogs:query"))),
    ).pipe(Effect.asVoid);

  return {
    upsertProfile,
    getProfileByRepoRoot,
    getProfileById,
    upsertRun,
    getRun,
    listRuns,
    appendLogs,
  } satisfies PatchRepositoryShape;
});

export const PatchRepositoryLive = Layer.effect(PatchRepository, makePatchRepository);
