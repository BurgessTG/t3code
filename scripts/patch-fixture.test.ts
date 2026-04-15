// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { PATCH_FIXTURE_SCENARIOS, createPatchFixture } from "./patch-fixture.ts";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("patch-fixture", () => {
  it("creates a clean scenario fixture with fork and upstream remotes", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "t3-patch-fixture-"));
    const rootDir = resolve(tempRoot, "fixture");

    try {
      const manifest = createPatchFixture({
        rootDir,
        scenario: "clean",
        sourceRepoRoot: "/repo/source",
        seedProfile: true,
      });

      expect(existsSync(resolve(rootDir, "manifest.json"))).toBe(true);
      expect(existsSync(resolve(rootDir, "README.md"))).toBe(true);
      expect(existsSync(resolve(manifest.workspaces.fork, "patch.md"))).toBe(true);

      const remotes = runGit(["remote", "-v"], manifest.workspaces.fork);
      expect(remotes).toContain(manifest.remotes.forkBare);
      expect(remotes).toContain(manifest.remotes.upstreamBare);

      const [aheadRaw = "0", behindRaw = "0"] = runGit(
        ["rev-list", "--left-right", "--count", "HEAD...upstream/main"],
        manifest.workspaces.fork,
      ).split(/\s+/g);
      expect(Number.parseInt(aheadRaw, 10)).toBeGreaterThan(0);
      expect(Number.parseInt(behindRaw, 10)).toBeGreaterThan(0);

      const patchMarkdown = readFileSync(resolve(manifest.workspaces.fork, "patch.md"), "utf8");
      expect(patchMarkdown).toContain("upstream: pingdotgg/t3code");
      expect(patchMarkdown).toContain("grep -q -- 'fork: patch button layout' src/theme.css");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("publishes scenario metadata for the validation failure path", () => {
    expect(PATCH_FIXTURE_SCENARIOS["validation-failure"].expectedRunStatus).toBe(
      "validation_failed",
    );
    expect(PATCH_FIXTURE_SCENARIOS["validation-failure"].init.testCommands).toContain(
      "test -f src/layout.txt",
    );
  });
});
