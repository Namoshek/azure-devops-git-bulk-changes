import {
  AddContentOperation,
  AddOperation,
  BulkOperation,
  BulkChangeError,
  DeleteOperation,
  EngineLimits,
  OpResult,
  ReplaceOperation,
} from "./types";
import { VirtualWorkspace, WorkspaceFile } from "./workspace";
import { normalizeGitPath } from "./pathUtils";

export interface OperationContext {
  limits: EngineLimits;
}

function result(
  index: number,
  op: BulkOperation,
  path: string,
  severity: OpResult["severity"],
  message: string,
): OpResult {
  return { index, kind: op.kind, path, severity, message };
}

function describeUnreadable(file: WorkspaceFile): string {
  return file.skipReason ?? "its content is not readable as text";
}

function buildFindPattern(op: ReplaceOperation): RegExp {
  const source = op.useRegex ? op.find : escapeRegExp(op.find);
  // Replacements always apply to every match; the global flag is implied.
  const flags = op.useRegex ? ensureGlobal(op.flags) : "g";
  try {
    return new RegExp(source, flags);
  } catch (err) {
    throw new BulkChangeError(
      "invalid_regex",
      op.useRegex
        ? `"find" is not a valid regular expression${op.flags ? ` with flags "${op.flags}"` : ""}: ${String(err)}`
        : `Failed to build the literal search pattern: ${String(err)}`,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

/** Count matches safely, including for patterns that can match an empty string. */
function countMatches(text: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of text.matchAll(pattern)) {
    count += 1;
    if (count > 100_000) {
      break;
    }
  }
  return count;
}

function applyAdd(
  workspace: VirtualWorkspace,
  index: number,
  path: string,
  content: string,
  onlyIfMissing: boolean,
): OpResult {
  const op: AddOperation = { kind: "add", path, content, onlyIfMissing };
  const existing = workspace.get(path);

  if (!existing) {
    workspace.set(path, content);
    return result(index, op, path, "applied", `${path} would be created (${content.length} characters).`);
  }

  if (onlyIfMissing) {
    return result(index, op, path, "noop", `${path} already exists — nothing to add.`);
  }

  if (existing.content === content) {
    return result(index, op, path, "noop", `${path} already has exactly this content.`);
  }

  if (existing.content === null) {
    return result(
      index,
      op,
      path,
      "error",
      `${path} exists but cannot be overwritten because ${describeUnreadable(existing)}.`,
    );
  }

  workspace.set(path, content);
  return result(index, op, path, "applied", `${path} already exists — its content would be replaced.`);
}

function applyDelete(workspace: VirtualWorkspace, index: number, op: DeleteOperation, path: string): OpResult {
  const existing = op.recursive ? workspace.paths().filter((candidate) => isInTree(candidate, path)) : [];
  const found = op.recursive ? existing.length > 0 : workspace.has(path);

  if (!found) {
    const noun = op.recursive ? "does not exist or is empty" : "does not exist";
    if (op.onFileMissing === "skip") {
      return result(index, op, path, "noop", `${path} ${noun} — deletion skipped.`);
    }
    return result(index, op, path, "error", `${path} ${noun} in this repository.`);
  }

  if (op.recursive) {
    const removed = workspace.removeTree(path);
    return result(index, op, path, "applied", `${path}: ${removed.length} file(s) would be deleted.`);
  }

  workspace.remove(path);
  return result(index, op, path, "applied", `${path} would be deleted.`);
}

function isInTree(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root === "/" ? "/" : `${root}/`);
}

/** `text` with every line ending replaced by `eol`, and exactly one terminating line ending. */
function asWholeLines(text: string, eol: string): string {
  const converted = text.replace(/\r\n|\r|\n/g, eol);
  return converted.endsWith(eol) ? converted : `${converted}${eol}`;
}

function applyAddContent(
  workspace: VirtualWorkspace,
  index: number,
  op: AddContentOperation,
  path: string,
  limits: EngineLimits,
): OpResult {
  const existing = workspace.get(path);

  if (!existing) {
    if (op.onFileMissing === "createIfMissing") {
      workspace.set(path, asWholeLines(op.content, "\n"));
      return result(index, op, path, "applied", `${path} does not exist — it would be created with the content.`);
    }
    if (op.onFileMissing === "skip") {
      return result(index, op, path, "noop", `${path} does not exist — nothing added.`);
    }
    return result(index, op, path, "error", `${path} does not exist in this repository.`);
  }

  if (existing.content === null) {
    const detail = `cannot be modified because ${describeUnreadable(existing)}`;
    return result(index, op, path, op.onFileMissing === "skip" ? "noop" : "error", `${path} ${detail}.`);
  }

  const current = existing.content;
  const needle = op.content.replace(/\r\n|\r/g, "\n").trim();
  if (op.skipIfPresent && needle !== "" && current.replace(/\r\n|\r/g, "\n").includes(needle)) {
    return result(index, op, path, "noop", `${path} already contains this content.`);
  }

  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const block = asWholeLines(op.content, eol);
  const lines = current.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  let next: string;
  let where: string;
  if (op.position === "start") {
    next = block + current;
    where = "at the start";
  } else if (op.position === "lineNumber") {
    const lineNumber = op.lineNumber ?? 1;
    if (lineNumber > lines.length + 1) {
      return result(
        index,
        op,
        path,
        "error",
        `${path} has ${lines.length} line(s); cannot insert before line ${lineNumber}.`,
      );
    }
    const before = lines.slice(0, lineNumber - 1).join("");
    const after = lines.slice(lineNumber - 1).join("");
    // Inserting after an unterminated last line needs a line ending of its own.
    const separator = after === "" && before !== "" && !before.endsWith("\n") ? eol : "";
    next = `${before}${separator}${block}${after}`;
    where = `before line ${lineNumber}`;
  } else {
    const separator = current === "" || current.endsWith("\n") ? "" : eol;
    next = `${current}${separator}${block}`;
    where = "at the end";
  }

  if (next.length > limits.maxFileChars) {
    return result(
      index,
      op,
      path,
      "error",
      `${path} would grow to ${next.length} characters, above the ${limits.maxFileChars} character limit.`,
    );
  }

  workspace.set(path, next);
  return result(index, op, path, "applied", `${path}: content would be added ${where}.`);
}

function applyRename(
  workspace: VirtualWorkspace,
  index: number,
  from: string,
  to: string,
  onFileMissing: "error" | "skip",
): OpResult {
  const op = { kind: "rename" as const, from, to, onFileMissing };

  if (from === to) {
    return result(index, op, from, "error", "Rename source and target are the same path.");
  }

  const source = workspace.get(from);
  if (!source) {
    if (onFileMissing === "skip") {
      return result(index, op, from, "noop", `${from} does not exist — rename skipped.`);
    }
    return result(index, op, from, "error", `${from} does not exist in this repository.`);
  }

  if (workspace.has(to)) {
    return result(index, op, to, "error", `Rename target ${to} already exists.`);
  }

  const collisions = workspace.caseInsensitiveCollisions(to);
  workspace.rename(from, to);
  const message = collisions.length
    ? `${from} would move to ${to}. Note: ${collisions.join(", ")} differs only by case, which is ambiguous in most working trees.`
    : `${from} would move to ${to}.`;
  return result(index, op, to, collisions.length ? "warning" : "applied", message);
}

function applyReplace(
  workspace: VirtualWorkspace,
  index: number,
  op: ReplaceOperation,
  path: string,
  limits: EngineLimits,
): OpResult {
  const existing = workspace.get(path);

  if (!existing) {
    if (op.onNoMatch === "createIfMissing") {
      workspace.set(path, op.replace);
      return result(
        index,
        op,
        path,
        "applied",
        `${path} does not exist — it would be created with the replacement text.`,
      );
    }
    if (op.onNoMatch === "skip") {
      return result(index, op, path, "noop", `${path} does not exist — replacement skipped.`);
    }
    return result(index, op, path, "error", `${path} does not exist in this repository.`);
  }

  if (existing.content === null) {
    const detail = `cannot be modified because ${describeUnreadable(existing)}`;
    if (op.onNoMatch === "skip") {
      return result(index, op, path, "noop", `${path} ${detail}.`);
    }
    return result(index, op, path, "error", `${path} ${detail}.`);
  }

  let pattern: RegExp;
  try {
    pattern = buildFindPattern(op);
  } catch (err) {
    if (err instanceof BulkChangeError && op.onNoMatch === "skip") {
      return result(index, op, path, "noop", `${path}: ${err.message} — replacement skipped.`);
    }
    throw err;
  }

  const matches = countMatches(existing.content, pattern);
  if (matches === 0) {
    if (op.onNoMatch === "skip") {
      return result(index, op, path, "noop", `${path} does not contain the search pattern — replacement skipped.`);
    }
    if (op.onNoMatch === "createIfMissing") {
      // The file exists, so there is nothing to create: treated as a skip with a warning.
      return result(index, op, path, "warning", `${path} does not contain the search pattern — nothing changed.`);
    }
    return result(index, op, path, "error", `${path} does not contain the search pattern.`);
  }

  const next = existing.content.replace(pattern, op.replace);
  if (next === existing.content) {
    return result(index, op, path, "noop", `${path}: ${matches} match(es) replaced, but the content is unchanged.`);
  }
  if (next.length > limits.maxFileChars) {
    return result(
      index,
      op,
      path,
      "error",
      `${path} would grow to ${next.length} characters, above the ${limits.maxFileChars} character limit.`,
    );
  }

  workspace.set(path, next);
  return result(index, op, path, "applied", `${path}: ${matches} replacement(s) in ${path}.`);
}

/**
 * Apply one operation to the virtual workspace.
 *
 * `error` results are reported by the engine as a failed repository: the whole operation sequence for
 * that repository is discarded, so a partially applied definition is never pushed.
 */
export function applyOperation(
  workspace: VirtualWorkspace,
  op: BulkOperation,
  index: number,
  context: OperationContext,
): OpResult {
  switch (op.kind) {
    case "add":
      return applyAdd(workspace, index, normalizeGitPath(op.path), op.content, op.onlyIfMissing);
    case "addContent": {
      const normalized = normalizeGitPath(op.path);
      return applyAddContent(workspace, index, { ...op, path: normalized }, normalized, context.limits);
    }
    case "delete":
      return applyDelete(workspace, index, op, normalizeGitPath(op.path));
    case "rename":
      return applyRename(workspace, index, normalizeGitPath(op.from), normalizeGitPath(op.to), op.onFileMissing);
    case "replace": {
      const normalized = normalizeGitPath(op.path);
      return applyReplace(workspace, index, { ...op, path: normalized }, normalized, context.limits);
    }
    default: {
      const unknown = op as { kind: string };
      throw new BulkChangeError("unknown_operation", `Unsupported operation kind "${unknown.kind}".`);
    }
  }
}
