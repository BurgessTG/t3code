// @effect-diagnostics globalConsole:off globalConsoleInEffect:off
import { parseArgs } from "node:util";

import { Effect } from "effect";
import { PatchRunId } from "@t3tools/contracts";

import { PatchService } from "./Services/PatchService.ts";
import { patchServiceError } from "./internal.ts";

type PatchCommand =
  | "status"
  | "init"
  | "reconcile"
  | "get-run"
  | "apply"
  | "open-sandbox"
  | "discard-run";

function formatUsage(): string {
  return [
    "Usage:",
    "  t3 patch status [--cwd <path>]",
    "  t3 patch init [--cwd <path>] [--tracked-branch <branch>] [--strategy <commit-stack|hybrid>] [--test-command <command> ...] [--smoke-command <command> ...]",
    "  t3 patch reconcile [--cwd <path>]",
    "  t3 patch get-run <run-id> [--cwd <path>]",
    "  t3 patch apply <run-id> [--cwd <path>]",
    "  t3 patch open-sandbox <run-id> [--cwd <path>]",
    "  t3 patch discard-run <run-id> [--cwd <path>]",
  ].join("\n");
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function maybeCreatePatchCliProgram(argv: string[]) {
  if (argv[0] !== "patch") {
    return null;
  }

  const command = argv[1] as PatchCommand | undefined;
  const parsed = parseArgs({
    args: argv.slice(2),
    allowPositionals: true,
    options: {
      cwd: { type: "string" },
      strategy: { type: "string" },
      "tracked-branch": { type: "string" },
      "test-command": { type: "string", multiple: true },
      "smoke-command": { type: "string", multiple: true },
    },
  });
  const cwd = parsed.values.cwd ?? process.cwd();

  const logProgress = (message: string) => Effect.sync(() => console.log(message));

  return Effect.gen(function* () {
    const patchService = yield* PatchService;

    switch (command) {
      case "status": {
        const result = yield* patchService.status({ cwd });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "init": {
        const result = yield* patchService.generateProfile({
          cwd,
          ...(parsed.values.strategy
            ? { strategy: parsed.values.strategy as "commit-stack" | "hybrid" }
            : {}),
          ...(parsed.values["tracked-branch"]
            ? { trackedBranch: parsed.values["tracked-branch"] }
            : {}),
          ...(parsed.values["test-command"]?.length
            ? { testCommands: parsed.values["test-command"] }
            : {}),
          ...(parsed.values["smoke-command"]?.length
            ? { smokeCommands: parsed.values["smoke-command"] }
            : {}),
        });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "reconcile": {
        const result = yield* patchService.reconcile(
          { cwd },
          {
            eventPublisher: {
              publish: (event) =>
                logProgress(
                  `[patch] ${event.kind}: ${"message" in event ? event.message : "progress"}`,
                ),
            },
          },
        );
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "get-run": {
        const runId = parsed.positionals[0];
        if (!runId) {
          return yield* Effect.fail(
            patchServiceError("PatchCli.getRun", "Missing run id.\n\n" + formatUsage()),
          );
        }
        const result = yield* patchService.getRun({ cwd, runId: PatchRunId.make(runId) });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "apply": {
        const runId = parsed.positionals[0];
        if (!runId) {
          return yield* Effect.fail(
            patchServiceError("PatchCli.apply", "Missing run id.\n\n" + formatUsage()),
          );
        }
        const result = yield* patchService.apply({ cwd, runId: PatchRunId.make(runId) });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "open-sandbox": {
        const runId = parsed.positionals[0];
        if (!runId) {
          return yield* Effect.fail(
            patchServiceError("PatchCli.openSandbox", "Missing run id.\n\n" + formatUsage()),
          );
        }
        const result = yield* patchService.openSandbox({
          cwd,
          runId: PatchRunId.make(runId),
        });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      case "discard-run": {
        const runId = parsed.positionals[0];
        if (!runId) {
          return yield* Effect.fail(
            patchServiceError("PatchCli.discardRun", "Missing run id.\n\n" + formatUsage()),
          );
        }
        const result = yield* patchService.discardRun({
          cwd,
          runId: PatchRunId.make(runId),
        });
        yield* Effect.sync(() => printJson(result));
        return;
      }

      default:
        return yield* Effect.fail(
          patchServiceError(
            "PatchCli.command",
            `Unknown patch command '${command ?? ""}'.\n\n${formatUsage()}`,
          ),
        );
    }
  });
}
