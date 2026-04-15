import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_profiles (
      profile_id TEXT PRIMARY KEY,
      repo_root TEXT NOT NULL UNIQUE,
      upstream_owner TEXT NOT NULL,
      upstream_repo TEXT NOT NULL,
      upstream_default_branch TEXT NOT NULL,
      tracked_branch TEXT NOT NULL,
      upstream_remote_name TEXT NOT NULL,
      fork_remote_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      patch_strategy TEXT NOT NULL,
      test_commands_json TEXT NOT NULL,
      smoke_commands_json TEXT NOT NULL,
      fallback_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_markdown TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_targets (
      target_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      area TEXT NOT NULL,
      intent TEXT NOT NULL,
      path_globs_json TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES patch_profiles(profile_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS patch_targets_profile_id_idx
    ON patch_targets(profile_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_runs (
      run_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      upstream_from_commit TEXT NOT NULL,
      upstream_to_commit TEXT NOT NULL,
      fork_head_before TEXT NOT NULL,
      sandbox_branch TEXT NOT NULL,
      sandbox_worktree_path TEXT NOT NULL,
      apply_branch TEXT,
      status TEXT NOT NULL,
      confidence_score INTEGER NOT NULL,
      summary TEXT NOT NULL,
      report_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (profile_id) REFERENCES patch_profiles(profile_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS patch_runs_profile_id_started_at_idx
    ON patch_runs(profile_id, started_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_conflicts (
      conflict_id TEXT PRIMARY KEY,
      patch_run_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      conflict_kind TEXT NOT NULL,
      resolver TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      summary TEXT NOT NULL,
      resolved INTEGER NOT NULL,
      FOREIGN KEY (patch_run_id) REFERENCES patch_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS patch_conflicts_patch_run_id_idx
    ON patch_conflicts(patch_run_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_validation_results (
      validation_result_id TEXT PRIMARY KEY,
      patch_run_id TEXT NOT NULL,
      command TEXT NOT NULL,
      exit_code INTEGER,
      output_excerpt TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (patch_run_id) REFERENCES patch_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS patch_validation_results_patch_run_id_idx
    ON patch_validation_results(patch_run_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS patch_logs (
      log_id TEXT PRIMARY KEY,
      patch_run_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (patch_run_id) REFERENCES patch_runs(run_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS patch_logs_patch_run_id_created_at_idx
    ON patch_logs(patch_run_id, created_at ASC)
  `;
});
