import { describe, expect, it } from "vitest";

import {
  parseGitRemoteRepository,
  resolveAutoFeatureBranchName,
  sanitizeBranchFragment,
  sanitizeFeatureBranchName,
  splitRepositoryName,
} from "./git";

describe("git shared helpers", () => {
  it("sanitizes arbitrary branch fragments", () => {
    expect(sanitizeBranchFragment("  Fix Theme Button!!!  ")).toBe("fix-theme-button");
    expect(sanitizeFeatureBranchName("Patch Layer")).toBe("feature/patch-layer");
  });

  it("resolves unique feature branch names", () => {
    expect(resolveAutoFeatureBranchName(["feature/patch-layer"], "patch-layer")).toBe(
      "feature/patch-layer-2",
    );
  });

  it("parses GitHub remotes into owner/repo form", () => {
    expect(parseGitRemoteRepository("git@github.com:pingdotgg/t3code.git")).toBe(
      "pingdotgg/t3code",
    );
    expect(parseGitRemoteRepository("https://github.com/pingdotgg/t3code")).toBe(
      "pingdotgg/t3code",
    );
  });

  it("parses local path remotes into owner/repo form", () => {
    expect(parseGitRemoteRepository("/tmp/remotes/pingdotgg/t3code.git")).toBe("pingdotgg/t3code");
    expect(parseGitRemoteRepository("C:\\fixtures\\octocat\\t3code.git")).toBe("octocat/t3code");
  });

  it("parses file url remotes into owner/repo form", () => {
    expect(parseGitRemoteRepository("file:///tmp/remotes/pingdotgg/t3code.git")).toBe(
      "pingdotgg/t3code",
    );
  });

  it("splits repository names safely", () => {
    expect(splitRepositoryName("pingdotgg/t3code")).toEqual({
      owner: "pingdotgg",
      repo: "t3code",
    });
    expect(splitRepositoryName(null)).toBeNull();
    expect(splitRepositoryName("pingdotgg")).toBeNull();
  });
});
