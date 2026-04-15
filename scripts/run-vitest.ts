// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

declare const Bun: {
  spawn(input: {
    readonly cmd: readonly string[];
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
    readonly stderr: "inherit";
    readonly stdout: "inherit";
    readonly stdin: "inherit";
  }): { readonly exited: Promise<number> };
};

const cwd = process.cwd();
const tempRoot = resolve(
  process.env.HOME ?? cwd,
  ".t3code-vitest-tmp",
  createHash("sha1").update(cwd).digest("hex").slice(0, 12),
);
mkdirSync(tempRoot, { recursive: true });
const gitConfigPath = resolve(tempRoot, "gitconfig");
writeFileSync(gitConfigPath, "", "utf8");

const child = Bun.spawn({
  cmd: [process.execPath, "x", "vitest", "run", ...process.argv.slice(2)],
  cwd,
  env: {
    ...process.env,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    GIT_CONFIG_GLOBAL: gitConfigPath,
    GIT_CONFIG_NOSYSTEM: "1",
  },
  stderr: "inherit",
  stdout: "inherit",
  stdin: "inherit",
});

const exitCode = await child.exited;
process.exit(exitCode);
