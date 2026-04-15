/**
 * Sanitize an arbitrary string into a valid, lowercase git branch fragment.
 * Strips quotes, collapses separators, limits to 64 chars.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

/**
 * Sanitize a string into a `feature/…` branch name.
 * Preserves an existing `feature/` prefix or slash-separated namespace.
 */
export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  if (sanitized.includes("/")) {
    return sanitized.startsWith("feature/") ? sanitized : `feature/${sanitized}`;
  }
  return `feature/${sanitized}`;
}

const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";

/**
 * Resolve a unique `feature/…` branch name that doesn't collide with
 * any existing branch. Appends a numeric suffix when needed.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  );
  const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));

  if (!existingNames.has(resolvedBase)) {
    return resolvedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${resolvedBase}-${suffix}`;
}

function parseGitHubRemoteRepository(url: string): string | null {
  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return match?.[1]?.trim() ?? null;
}

function parseLocalRemoteRepository(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  let pathValue = trimmed;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (schemeMatch) {
    if (schemeMatch[1]?.toLowerCase() !== "file") return null;
    try {
      const parsed = new URL(trimmed);
      pathValue = `${parsed.host}${decodeURIComponent(parsed.pathname)}`;
    } catch {
      return null;
    }
  }

  const normalized = pathValue.replace(/\\/g, "/").replace(/\/+$/g, "");
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (segments.length < 2) return null;

  const owner = segments.at(-2)?.trim() ?? "";
  const repo = segments
    .at(-1)
    ?.replace(/\.git$/i, "")
    .trim();
  if (owner.length === 0 || !repo || repo.length === 0) return null;

  return `${owner}/${repo}`;
}

export function parseGitRemoteRepository(url: string): string | null {
  return parseGitHubRemoteRepository(url) ?? parseLocalRemoteRepository(url);
}

export function splitRepositoryName(
  repository: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!repository) return null;
  const [owner = "", repo = ""] = repository.split("/");
  if (owner.trim().length === 0 || repo.trim().length === 0) return null;
  return {
    owner: owner.trim(),
    repo: repo.trim(),
  };
}
