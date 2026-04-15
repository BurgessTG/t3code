import {
  PatchProfile,
  type PatchGenerateProfileInput,
  type PatchProfile as PatchProfileType,
} from "@t3tools/contracts";

export interface ParsedPatchFrontmatterTarget {
  area: string;
  intent: string;
  pathGlobs: string[];
  notes: string | null;
  priority: number;
}

export interface ParsedPatchFrontmatter {
  upstream: string;
  trackedBranch: string;
  strategy: PatchProfileType["patchStrategy"];
  baseCommit: string;
  testCommands: string[];
  smokeCommands: string[];
  patchTargets: ParsedPatchFrontmatterTarget[];
  fallback: PatchProfileType["fallback"];
  body: string;
}

const FRONTMATTER_BOUNDARY = "---";

function parseStrategy(value: string): PatchProfileType["patchStrategy"] {
  return value === "hybrid" ? "hybrid" : "commit-stack";
}

function parseFallback(value: string): PatchProfileType["fallback"] {
  return value === "needs-review" ? "needs-review" : "needs-review";
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseArrayOfStrings(lines: string[], startIndex: number) {
  const values: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith("  - ")) break;
    values.push(cleanScalar(line.slice(4)));
    index += 1;
  }
  return { values, nextIndex: index };
}

function parseArrayOfTargets(lines: string[], startIndex: number) {
  const values: ParsedPatchFrontmatterTarget[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith("  - ")) break;

    const target: ParsedPatchFrontmatterTarget = {
      area: "",
      intent: "",
      pathGlobs: [],
      notes: null,
      priority: 0,
    };
    const firstEntry = line.slice(4).trim();
    if (firstEntry.length > 0) {
      const separatorIndex = firstEntry.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid patch target entry: ${line}`);
      }
      const key = firstEntry.slice(0, separatorIndex).trim();
      const value = cleanScalar(firstEntry.slice(separatorIndex + 1));
      if (key === "area") target.area = value;
      if (key === "intent") target.intent = value;
      if (key === "notes") target.notes = value;
      if (key === "priority") target.priority = Number.parseInt(value, 10) || 0;
    }
    index += 1;

    while (index < lines.length) {
      const nestedLine = lines[index] ?? "";
      if (!nestedLine.startsWith("    ")) break;
      const trimmedNested = nestedLine.trim();
      if (trimmedNested === "pathGlobs:") {
        index += 1;
        while (index < lines.length) {
          const globLine = lines[index] ?? "";
          if (!globLine.startsWith("      - ")) break;
          target.pathGlobs.push(cleanScalar(globLine.slice(8)));
          index += 1;
        }
        continue;
      }

      const separatorIndex = trimmedNested.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid nested patch target entry: ${nestedLine}`);
      }
      const key = trimmedNested.slice(0, separatorIndex).trim();
      const value = cleanScalar(trimmedNested.slice(separatorIndex + 1));
      if (key === "area") target.area = value;
      if (key === "intent") target.intent = value;
      if (key === "notes") target.notes = value;
      if (key === "priority") target.priority = Number.parseInt(value, 10) || 0;
      index += 1;
    }

    if (target.area.length === 0 || target.intent.length === 0) {
      throw new Error("Every patch target must include both area and intent.");
    }
    values.push(target);
  }
  return { values, nextIndex: index };
}

export function parsePatchMarkdown(markdown: string): ParsedPatchFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    throw new Error("patch.md must begin with YAML frontmatter.");
  }

  const closingIndex = normalized.indexOf(
    `\n${FRONTMATTER_BOUNDARY}\n`,
    FRONTMATTER_BOUNDARY.length,
  );
  if (closingIndex === -1) {
    throw new Error("patch.md frontmatter is missing a closing boundary.");
  }

  const frontmatterText = normalized.slice(FRONTMATTER_BOUNDARY.length + 1, closingIndex);
  const body = normalized.slice(closingIndex + `\n${FRONTMATTER_BOUNDARY}\n`.length).trim();
  const lines = frontmatterText.split("\n");

  const result: ParsedPatchFrontmatter = {
    upstream: "",
    trackedBranch: "main",
    strategy: "commit-stack",
    baseCommit: "",
    testCommands: [],
    smokeCommands: [],
    patchTargets: [],
    fallback: "needs-review",
    body,
  };

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    index += 1;
    if (line.length === 0 || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${rawLine}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = cleanScalar(line.slice(separatorIndex + 1));

    if (key === "upstream") {
      result.upstream = value;
      continue;
    }
    if (key === "trackedBranch") {
      result.trackedBranch = value;
      continue;
    }
    if (key === "strategy") {
      result.strategy = parseStrategy(value);
      continue;
    }
    if (key === "baseCommit") {
      result.baseCommit = value;
      continue;
    }
    if (key === "fallback") {
      result.fallback = parseFallback(value);
      continue;
    }
    if (key === "testCommands" && value.length === 0) {
      const parsed = parseArrayOfStrings(lines, index);
      result.testCommands = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    if (key === "smokeCommands" && value.length === 0) {
      const parsed = parseArrayOfStrings(lines, index);
      result.smokeCommands = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    if (key === "patchTargets" && value.length === 0) {
      const parsed = parseArrayOfTargets(lines, index);
      result.patchTargets = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
  }

  if (result.upstream.length === 0) {
    throw new Error("patch.md frontmatter must define `upstream`.");
  }
  if (result.baseCommit.length === 0) {
    throw new Error("patch.md frontmatter must define `baseCommit`.");
  }

  return result;
}

function formatArrayOfStrings(key: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [`${key}: []`];
  }
  return [`${key}:`, ...values.map((value) => `  - ${value}`)];
}

function formatPatchTargets(targets: ReadonlyArray<ParsedPatchFrontmatterTarget>): string[] {
  if (targets.length === 0) {
    return ["patchTargets: []"];
  }

  const lines = ["patchTargets:"];
  for (const target of targets) {
    lines.push(`  - area: ${target.area}`);
    lines.push(`    intent: ${target.intent}`);
    if (target.pathGlobs.length > 0) {
      lines.push("    pathGlobs:");
      for (const glob of target.pathGlobs) {
        lines.push(`      - ${glob}`);
      }
    }
    if (target.notes) {
      lines.push(`    notes: ${target.notes}`);
    }
    if (target.priority > 0) {
      lines.push(`    priority: ${target.priority}`);
    }
  }
  return lines;
}

export function serializePatchMarkdown(input: ParsedPatchFrontmatter): string {
  const lines = [
    FRONTMATTER_BOUNDARY,
    `upstream: ${input.upstream}`,
    `trackedBranch: ${input.trackedBranch}`,
    `strategy: ${input.strategy}`,
    `baseCommit: ${input.baseCommit}`,
    ...formatArrayOfStrings("testCommands", input.testCommands),
    ...formatArrayOfStrings("smokeCommands", input.smokeCommands),
    ...formatPatchTargets(input.patchTargets),
    `fallback: ${input.fallback}`,
    FRONTMATTER_BOUNDARY,
    "",
    input.body.trim().length > 0 ? input.body.trim() : "# Patch profile",
    "",
  ];
  return lines.join("\n");
}

export function normalizePatchMarkdownInput(input: {
  upstream: string;
  trackedBranch: string;
  strategy?: PatchGenerateProfileInput["strategy"];
  baseCommit: string;
  testCommands: readonly string[];
  smokeCommands: readonly string[];
  targets?: ReadonlyArray<{
    area: string;
    intent: string;
    pathGlobs?: readonly string[];
    notes?: string;
    priority?: number;
  }>;
  body?: string;
}): ParsedPatchFrontmatter {
  return {
    upstream: input.upstream.trim(),
    trackedBranch: input.trackedBranch.trim(),
    strategy: input.strategy ?? "commit-stack",
    baseCommit: input.baseCommit.trim(),
    testCommands: input.testCommands.map((command) => command.trim()).filter(Boolean),
    smokeCommands: input.smokeCommands.map((command) => command.trim()).filter(Boolean),
    patchTargets:
      input.targets?.map((target) => ({
        area: target.area.trim(),
        intent: target.intent.trim(),
        pathGlobs: target.pathGlobs?.map((glob) => glob.trim()).filter(Boolean) ?? [],
        notes: target.notes?.trim() || null,
        priority: target.priority ?? 0,
      })) ?? [],
    fallback: "needs-review",
    body:
      input.body?.trim() ||
      "# Patch profile\n\nKeep this fork-specific patch workflow aligned with upstream T3 Code.",
  };
}

export function summarizePatchProfile(profile: PatchProfile): string {
  return `${profile.upstreamOwner}/${profile.upstreamRepo} • ${profile.patchStrategy} • ${profile.targets.length} target${profile.targets.length === 1 ? "" : "s"}`;
}
