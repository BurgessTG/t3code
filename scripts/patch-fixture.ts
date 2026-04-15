#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { normalizePatchMarkdownInput, serializePatchMarkdown } from "@t3tools/shared/patch";

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(CURRENT_FILE_PATH), "..");
const DEFAULT_FIXTURE_BASE_DIR = resolve(homedir(), ".t3code-patch-fixtures");
const DEFAULT_UPSTREAM_OWNER = "pingdotgg";
const DEFAULT_FORK_OWNER = "local-user";
const DEFAULT_REPOSITORY_NAME = "t3code";
const DEFAULT_GIT_USER_NAME = "T3 Patch Fixture";
const DEFAULT_GIT_USER_EMAIL = "patch-fixture@example.com";

const BASE_README = `# Patch Fixture

This disposable repository simulates a fork that carries a small UI customization layer.
`;

const BASE_THEME_CSS = `:root {
  --accent: royalblue;
  --surface: white;
}

.patch-button {
  background: var(--accent);
  border-radius: 10px;
  color: black;
}
`;

const FORK_THEME_CSS = `:root {
  --accent: royalblue;
  --surface: white;
}

.patch-button {
  /* fork: patch button layout */
  background: linear-gradient(var(--accent), teal);
  border-radius: 999px;
  color: white;
}
`;

const UPSTREAM_CONFLICT_THEME_CSS = `:root {
  --accent: royalblue;
  --surface: white;
}

.patch-button {
  background: var(--accent);
  border-radius: 0;
  color: black;
  letter-spacing: 0.08em;
}
`;

const UPSTREAM_RENAMED_THEME_CSS = `:root {
  --accent: midnightblue;
  --surface: white;
}

.patch-button {
  background: var(--accent);
  border-radius: 12px;
  color: white;
}
`;

const BASE_LAYOUT = `header
sidebar
content
`;

const BASE_PACKAGE_JSON = JSON.stringify(
  {
    name: "patch-fixture",
    private: true,
    scripts: {
      fmt: "git diff --check",
      lint: "test -f README.md",
      typecheck: "test -f src/theme.css || test -f src/styles/theme.css",
      test: "grep -q -- 'patch-button' src/theme.css || grep -q -- 'patch-button' src/styles/theme.css",
    },
  },
  null,
  2,
);

type PatchFixtureScenario = keyof typeof PATCH_FIXTURE_SCENARIOS;

type PatchFixtureManifest = {
  scenario: PatchFixtureScenario;
  rootDir: string;
  sourceRepoRoot: string;
  upstreamOwner: string;
  forkOwner: string;
  repositoryName: string;
  remotes: {
    upstreamBare: string;
    forkBare: string;
  };
  workspaces: {
    upstream: string;
    fork: string;
  };
  init: {
    trackedBranch: string;
    testCommands: string[];
    smokeCommands: string[];
  };
  expectedRunStatus: string;
  expectedStatusState: string;
  recommendedCommands: {
    statusBeforeInit: string;
    init: string;
    reconcile: string;
    statusAfterReconcile: string;
    getRun: string;
    openSandbox: string;
    apply: string;
  };
};

type PatchFixtureScenarioDefinition = {
  description: string;
  expectedRunStatus: string;
  expectedStatusState: string;
  init: {
    testCommands: string[];
    smokeCommands: string[];
  };
  applyUpstreamChanges: (repoDir: string) => void;
};

export const PATCH_FIXTURE_SCENARIOS = {
  clean: {
    description:
      "Fork-only theme customization replays cleanly on top of unrelated upstream changes.",
    expectedRunStatus: "ready_for_review",
    expectedStatusState: "ready_to_apply",
    init: {
      testCommands: ["git diff --check", "grep -q -- 'fork: patch button layout' src/theme.css"],
      smokeCommands: [],
    },
    applyUpstreamChanges(repoDir) {
      writeRepoFile(
        repoDir,
        "README.md",
        `${BASE_README}\n## Upstream note\n\nThe upstream layout shipped a docs refresh.\n`,
      );
      writeRepoFile(
        repoDir,
        "docs/changelog.md",
        `# Changelog\n\n- Added upstream docs refresh for the clean patch scenario.\n`,
      );
      commitAll(repoDir, "Refresh upstream docs");
    },
  },
  "content-conflict": {
    description: "Fork and upstream both edit the same theme block, forcing a content conflict.",
    expectedRunStatus: "conflicted",
    expectedStatusState: "needs_manual_investigation",
    init: {
      testCommands: ["git diff --check", "grep -q -- 'fork: patch button layout' src/theme.css"],
      smokeCommands: [],
    },
    applyUpstreamChanges(repoDir) {
      writeRepoFile(repoDir, "src/theme.css", UPSTREAM_CONFLICT_THEME_CSS);
      commitAll(repoDir, "Adjust patch button styling upstream");
    },
  },
  "rename-conflict": {
    description:
      "Upstream renames the customized file, forcing a rename/delete style conflict during replay.",
    expectedRunStatus: "conflicted",
    expectedStatusState: "needs_manual_investigation",
    init: {
      testCommands: ["git diff --check"],
      smokeCommands: [],
    },
    applyUpstreamChanges(repoDir) {
      gitMove(repoDir, "src/theme.css", "src/styles/theme.css");
      writeRepoFile(repoDir, "src/styles/theme.css", UPSTREAM_RENAMED_THEME_CSS);
      commitAll(repoDir, "Move theme stylesheet into styles directory");
    },
  },
  "validation-failure": {
    description:
      "Replay succeeds, but validation fails because upstream removed a file the patch profile still expects.",
    expectedRunStatus: "validation_failed",
    expectedStatusState: "validation_failed",
    init: {
      testCommands: ["git diff --check", "test -f src/layout.txt"],
      smokeCommands: [],
    },
    applyUpstreamChanges(repoDir) {
      rmSync(resolve(repoDir, "src/layout.txt"), { force: true });
      writeRepoFile(
        repoDir,
        "README.md",
        `${BASE_README}\n## Upstream note\n\nThe old text layout file was removed in favor of generated layout metadata.\n`,
      );
      commitAll(repoDir, "Remove legacy layout file");
    },
  },
} as const satisfies Record<string, PatchFixtureScenarioDefinition>;

type CreatePatchFixtureOptions = {
  rootDir: string;
  scenario: PatchFixtureScenario;
  sourceRepoRoot?: string;
  upstreamOwner?: string;
  forkOwner?: string;
  repositoryName?: string;
  force?: boolean;
  seedProfile?: boolean;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runGit(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeRepoFile(repoDir: string, relativePath: string, contents: string): void {
  const filePath = resolve(repoDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function configureRepositoryUser(repoDir: string): void {
  runGit(["config", "user.name", DEFAULT_GIT_USER_NAME], repoDir);
  runGit(["config", "user.email", DEFAULT_GIT_USER_EMAIL], repoDir);
}

function commitAll(repoDir: string, message: string): void {
  runGit(["add", "-A"], repoDir);
  runGit(["commit", "-m", message], repoDir);
}

function gitMove(repoDir: string, fromPath: string, toPath: string): void {
  mkdirSync(dirname(resolve(repoDir, toPath)), { recursive: true });
  runGit(["mv", fromPath, toPath], repoDir);
}

function readCurrentCommit(repoDir: string): string {
  return runGit(["rev-parse", "HEAD"], repoDir);
}

function writeBaseRepository(repoDir: string): void {
  writeRepoFile(repoDir, "README.md", BASE_README);
  writeRepoFile(repoDir, "package.json", `${BASE_PACKAGE_JSON}\n`);
  writeRepoFile(repoDir, "src/theme.css", BASE_THEME_CSS);
  writeRepoFile(repoDir, "src/layout.txt", BASE_LAYOUT);
  commitAll(repoDir, "Create base upstream scaffold");
}

function applyForkChanges(repoDir: string): void {
  writeRepoFile(repoDir, "src/theme.css", FORK_THEME_CSS);
  commitAll(repoDir, "Customize patch button styling");

  writeRepoFile(
    repoDir,
    "src/fork-workflow.md",
    `# Fork workflow\n\nThis file represents a fork-only customization note.\n`,
  );
  commitAll(repoDir, "Document fork-only workflow");
}

function buildPatchInitCommand(
  sourceRepoRoot: string,
  forkWorkspace: string,
  scenario: PatchFixtureScenario,
): string {
  const definition = PATCH_FIXTURE_SCENARIOS[scenario];
  const parts = [
    "bun",
    "run",
    "--cwd",
    shellQuote(resolve(sourceRepoRoot, "apps/server")),
    "src/index.ts",
    "patch",
    "init",
    "--cwd",
    shellQuote(forkWorkspace),
    "--tracked-branch",
    "main",
  ];

  for (const command of definition.init.testCommands) {
    parts.push("--test-command", shellQuote(command));
  }
  for (const command of definition.init.smokeCommands) {
    parts.push("--smoke-command", shellQuote(command));
  }

  return parts.join(" ");
}

function buildPatchCommand(
  sourceRepoRoot: string,
  action: string,
  cwd: string,
  runIdPlaceholder?: string,
): string {
  const parts = [
    "bun",
    "run",
    "--cwd",
    shellQuote(resolve(sourceRepoRoot, "apps/server")),
    "src/index.ts",
    "patch",
    action,
  ];
  if (runIdPlaceholder) {
    parts.push(runIdPlaceholder);
  }
  parts.push("--cwd", shellQuote(cwd));
  return parts.join(" ");
}

function writeSeedProfile(
  forkWorkspace: string,
  upstreamOwner: string,
  repositoryName: string,
  baseCommit: string,
  scenario: PatchFixtureScenario,
): void {
  const definition = PATCH_FIXTURE_SCENARIOS[scenario];
  const markdown = serializePatchMarkdown(
    normalizePatchMarkdownInput({
      upstream: `${upstreamOwner}/${repositoryName}`,
      trackedBranch: "main",
      strategy: "commit-stack",
      baseCommit,
      testCommands: definition.init.testCommands,
      smokeCommands: definition.init.smokeCommands,
      targets: [
        {
          area: "theme",
          intent: "Preserve the fork-specific patch button styling.",
          pathGlobs: ["src/theme.css", "src/styles/theme.css"],
        },
      ],
    }),
  );
  writeRepoFile(forkWorkspace, "patch.md", markdown);
}

function writeFixtureReadme(manifest: PatchFixtureManifest, profileSeeded: boolean): void {
  const lines = [
    "# Local Patch Fixture",
    "",
    `Scenario: \`${manifest.scenario}\``,
    "",
    PATCH_FIXTURE_SCENARIOS[manifest.scenario].description,
    "",
    `Expected run status: \`${manifest.expectedRunStatus}\``,
    `Expected status state: \`${manifest.expectedStatusState}\``,
    "",
    "Paths:",
    `- Fixture root: \`${manifest.rootDir}\``,
    `- Upstream remote: \`${manifest.remotes.upstreamBare}\``,
    `- Fork remote: \`${manifest.remotes.forkBare}\``,
    `- Upstream workspace: \`${manifest.workspaces.upstream}\``,
    `- Fork workspace: \`${manifest.workspaces.fork}\``,
    "",
    profileSeeded
      ? "A `patch.md` profile was pre-seeded into the fork workspace."
      : "No `patch.md` profile was written. Start by running the init command below.",
    "",
    "Recommended commands:",
    `1. ${manifest.recommendedCommands.statusBeforeInit}`,
    `2. ${manifest.recommendedCommands.init}`,
    `3. ${manifest.recommendedCommands.reconcile}`,
    `4. ${manifest.recommendedCommands.statusAfterReconcile}`,
    `5. ${manifest.recommendedCommands.getRun}`,
    `6. ${manifest.recommendedCommands.openSandbox}`,
    `7. ${manifest.recommendedCommands.apply}`,
    "",
    "Replace `PATCH_RUN_ID` with the `id` emitted by `patch reconcile`.",
    "",
  ];
  writeFileSync(resolve(manifest.rootDir, "README.md"), lines.join("\n"), "utf8");
}

export function createPatchFixture(options: CreatePatchFixtureOptions): PatchFixtureManifest {
  const scenario = options.scenario;
  const definition = PATCH_FIXTURE_SCENARIOS[scenario];
  const rootDir = resolve(options.rootDir);
  const sourceRepoRoot = resolve(options.sourceRepoRoot ?? repoRoot);
  const upstreamOwner = options.upstreamOwner ?? DEFAULT_UPSTREAM_OWNER;
  const forkOwner = options.forkOwner ?? DEFAULT_FORK_OWNER;
  const repositoryName = options.repositoryName ?? DEFAULT_REPOSITORY_NAME;

  if (existsSync(rootDir)) {
    if (!options.force) {
      throw new Error(`Fixture root already exists: ${rootDir}`);
    }
    rmSync(rootDir, { recursive: true, force: true });
  }

  mkdirSync(rootDir, { recursive: true });

  const upstreamBare = resolve(rootDir, "remotes", upstreamOwner, `${repositoryName}.git`);
  const forkBare = resolve(rootDir, "remotes", forkOwner, `${repositoryName}.git`);
  const upstreamWorkspace = resolve(rootDir, "workspaces", "upstream");
  const forkWorkspace = resolve(rootDir, "workspaces", "fork");

  mkdirSync(dirname(upstreamBare), { recursive: true });
  mkdirSync(dirname(forkBare), { recursive: true });

  runGit(["init", "--bare", "--initial-branch", "main", upstreamBare]);
  runGit(["clone", upstreamBare, upstreamWorkspace]);
  configureRepositoryUser(upstreamWorkspace);
  writeBaseRepository(upstreamWorkspace);
  runGit(["push", "origin", "main"], upstreamWorkspace);

  runGit(["init", "--bare", "--initial-branch", "main", forkBare]);
  runGit(["push", forkBare, "main:main"], upstreamWorkspace);

  runGit(["clone", forkBare, forkWorkspace]);
  configureRepositoryUser(forkWorkspace);
  runGit(["remote", "add", "upstream", upstreamBare], forkWorkspace);

  applyForkChanges(forkWorkspace);
  runGit(["push", "origin", "main"], forkWorkspace);

  definition.applyUpstreamChanges(upstreamWorkspace);
  runGit(["push", "origin", "main"], upstreamWorkspace);
  runGit(["fetch", "upstream", "main"], forkWorkspace);

  const forkHeadCommit = readCurrentCommit(forkWorkspace);
  if (options.seedProfile) {
    writeSeedProfile(forkWorkspace, upstreamOwner, repositoryName, forkHeadCommit, scenario);
  }

  const manifest: PatchFixtureManifest = {
    scenario,
    rootDir,
    sourceRepoRoot,
    upstreamOwner,
    forkOwner,
    repositoryName,
    remotes: {
      upstreamBare,
      forkBare,
    },
    workspaces: {
      upstream: upstreamWorkspace,
      fork: forkWorkspace,
    },
    init: {
      trackedBranch: "main",
      testCommands: [...definition.init.testCommands],
      smokeCommands: [...definition.init.smokeCommands],
    },
    expectedRunStatus: definition.expectedRunStatus,
    expectedStatusState: definition.expectedStatusState,
    recommendedCommands: {
      statusBeforeInit: buildPatchCommand(sourceRepoRoot, "status", forkWorkspace),
      init: buildPatchInitCommand(sourceRepoRoot, forkWorkspace, scenario),
      reconcile: buildPatchCommand(sourceRepoRoot, "reconcile", forkWorkspace),
      statusAfterReconcile: buildPatchCommand(sourceRepoRoot, "status", forkWorkspace),
      getRun: buildPatchCommand(sourceRepoRoot, "get-run", forkWorkspace, "PATCH_RUN_ID"),
      openSandbox: buildPatchCommand(sourceRepoRoot, "open-sandbox", forkWorkspace, "PATCH_RUN_ID"),
      apply: buildPatchCommand(sourceRepoRoot, "apply", forkWorkspace, "PATCH_RUN_ID"),
    },
  };

  writeFileSync(
    resolve(rootDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  writeFixtureReadme(manifest, Boolean(options.seedProfile));
  return manifest;
}

function defaultFixtureRoot(scenario: PatchFixtureScenario): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(DEFAULT_FIXTURE_BASE_DIR, `${scenario}-${timestamp}`);
}

function formatUsage(): string {
  const scenarioList = Object.keys(PATCH_FIXTURE_SCENARIOS).join("|");
  return [
    "Usage:",
    `  bun run patch:fixture -- [--scenario <${scenarioList}>] [--root <path>] [--force] [--seed-profile]`,
    "",
    "Examples:",
    "  bun run patch:fixture -- --scenario clean",
    "  bun run patch:fixture -- --scenario rename-conflict --seed-profile",
  ].join("\n");
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      scenario: { type: "string" },
      root: { type: "string" },
      force: { type: "boolean" },
      "seed-profile": { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (parsed.values.help) {
    console.log(formatUsage());
    return;
  }

  const scenario = (parsed.values.scenario ?? "clean") as PatchFixtureScenario;
  if (!(scenario in PATCH_FIXTURE_SCENARIOS)) {
    throw new Error(`Unknown scenario '${scenario}'.\n\n${formatUsage()}`);
  }

  const manifestOptions: CreatePatchFixtureOptions = {
    rootDir: parsed.values.root ?? defaultFixtureRoot(scenario),
    scenario,
  };
  if (parsed.values.force !== undefined) {
    manifestOptions.force = parsed.values.force;
  }
  if (parsed.values["seed-profile"] !== undefined) {
    manifestOptions.seedProfile = parsed.values["seed-profile"];
  }

  const manifest = createPatchFixture(manifestOptions);

  const relativeManifest = relative(process.cwd(), resolve(manifest.rootDir, "manifest.json"));
  const relativeReadme = relative(process.cwd(), resolve(manifest.rootDir, "README.md"));

  console.log(`Created local patch fixture: ${manifest.rootDir}`);
  console.log(`Scenario: ${manifest.scenario}`);
  console.log(`Fork workspace: ${manifest.workspaces.fork}`);
  console.log(`Expected run status: ${manifest.expectedRunStatus}`);
  console.log(`Expected status state: ${manifest.expectedStatusState}`);
  console.log(`Manifest: ${relativeManifest || resolve(manifest.rootDir, "manifest.json")}`);
  console.log(`Guide: ${relativeReadme || resolve(manifest.rootDir, "README.md")}`);

  if (parsed.values["seed-profile"]) {
    const patchPath = resolve(manifest.workspaces.fork, "patch.md");
    const preview = readFileSync(patchPath, "utf8").split(/\r?\n/g).slice(0, 8).join("\n");
    console.log("");
    console.log("Seeded patch profile preview:");
    console.log(preview);
  }
}

if (CURRENT_FILE_PATH === process.argv[1]) {
  main();
}
