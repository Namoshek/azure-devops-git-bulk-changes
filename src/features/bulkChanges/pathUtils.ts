import { BulkChangeError } from "./types";

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

/** Git paths are case-sensitive on the server; equality is exact after normalization. */
export function isPathEqual(a: string, b: string): boolean {
  return a === b;
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
