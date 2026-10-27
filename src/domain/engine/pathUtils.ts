import { BulkChangeError } from "../types";

/**
 * Normalize a user-supplied repository path to Git's canonical POSIX form.
 *
 * Rules:
 * - Always forward slashes.
 * - Always exactly one leading slash (repository-root-relative).
 * - Duplicate and trailing slashes collapse; `.` segments are dropped.
 * - Empty paths and `..` escapes are rejected.
 */
export function normalizeGitPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new BulkChangeError("invalid_path", "Path must not be empty.");
  }

  const backslashNormalized = trimmed.replace(/\\/g, "/");
  const withLeadingSlash = backslashNormalized.startsWith("/") ? backslashNormalized : `/${backslashNormalized}`;

  const segments: string[] = [];
  for (const rawSegment of withLeadingSlash.split("/")) {
    if (rawSegment === "" || rawSegment === ".") {
      continue;
    }
    if (rawSegment === "..") {
      throw new BulkChangeError("invalid_path", `Path "${input}" must stay inside the repository (it contains "..").`);
    }
    segments.push(rawSegment);
  }

  if (segments.length === 0) {
    throw new BulkChangeError("invalid_path", `Path "${input}" does not point to a file.`);
  }

  return `/${segments.join("/")}`;
}

/** Non-throwing variant of `normalizeGitPath`, for validation. Returns `null` when invalid. */
export function tryNormalizeGitPath(input: string): string | null {
  try {
    return normalizeGitPath(input);
  } catch {
    return null;
  }
}

/** Case-insensitive comparison, used only to warn about likely collisions. */
export function isPathEqualIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** `/a/b/c.txt` -> `/a/b`. Root returns `/`. */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return path.slice(0, index);
}

/** `/a/b/c.txt` -> `c.txt`. */
export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/** True when `path` is strictly inside `prefix` (e.g. `/a/b` under `/a`). */
export function isUnderPath(path: string, prefix: string): boolean {
  if (prefix === "/") {
    return path !== "/";
  }
  return path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/** Extension without the final dot, or empty string. */
export function extension(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

/** Characters that turn a path value into a glob-style pattern rather than a literal path. */
const PATH_PATTERN_METACHARS = /[*?[\]]/;

/** True when `value` uses glob metacharacters. */
export function isPathPattern(value: string): boolean {
  return PATH_PATTERN_METACHARS.test(value);
}

/**
 * Compile a path pattern into an anchored regular expression.
 *
 * `*` stays inside one path segment, `?` matches one character, `**` is a whole segment standing for
 * any number of segments (including none), and `[a-z]` classes pass through. Matching is case-sensitive
 * like Git paths, and a pattern obeys the same shape rules as a literal path (root-relative, no `..`),
 * so a typo can never escape the repository.
 */
export function compilePathPattern(pattern: string): RegExp {
  const cached = PATTERN_CACHE.get(pattern);
  if (cached) {
    return cached;
  }

  let normalized: string;
  try {
    normalized = normalizeGitPath(pattern);
  } catch {
    throw new BulkChangeError(
      "invalid_pattern",
      `Path pattern "${pattern}" must be a repository-root-relative path without "..".`,
    );
  }

  const segments = normalized === "/" ? [] : normalized.slice(1).split("/");
  let source = "^/";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? "(?:[^/]+(?:/[^/]+)*)?" : "(?:[^/]*/)*";
      continue;
    }
    if (segment.includes("**")) {
      throw new BulkChangeError(
        "invalid_pattern",
        `Path pattern "${pattern}" must use "**" as a whole segment, not inside "${segment}".`,
      );
    }
    source += compilePatternSegment(segment, pattern);
    if (!last) {
      source += "/";
    }
  }
  source += "$";

  let compiled: RegExp;
  try {
    compiled = new RegExp(source);
  } catch (err) {
    throw new BulkChangeError("invalid_pattern", `Path pattern "${pattern}" could not be compiled: ${String(err)}`);
  }
  PATTERN_CACHE.set(pattern, compiled);
  return compiled;
}

function compilePatternSegment(segment: string, pattern: string): string {
  let source = "";
  let index = 0;
  while (index < segment.length) {
    const char = segment[index];
    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    if (char === "[") {
      const close = segment.indexOf("]", index + 1);
      if (close < 0) {
        throw new BulkChangeError("invalid_pattern", `Path pattern "${pattern}" has an unterminated character class.`);
      }
      source += segment.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return source;
}

const PATTERN_CACHE = new Map<string, RegExp>();

/** True when the repository path `path` matches `pattern`. */
export function matchesPathPattern(pattern: string, path: string): boolean {
  const normalized = tryNormalizeGitPath(path);
  if (normalized === null) {
    return false;
  }
  return compilePathPattern(pattern).test(normalized);
}

/**
 * Longest literal directory prefix of `pattern`, used as the repository listing scope so a pattern
 * never forces a whole-repository scan. Root (`/`) when the first segment already matches.
 */
export function patternScopePath(pattern: string): string {
  const normalized = tryNormalizeGitPath(pattern) ?? "/";
  const segments = normalized === "/" ? [] : normalized.slice(1).split("/");
  const literal: string[] = [];
  for (const segment of segments) {
    if (isPathPattern(segment)) {
      break;
    }
    literal.push(segment);
  }
  return literal.length === 0 ? "/" : `/${literal.join("/")}`;
}
