import { FileDiff } from "../types";

const CONTEXT_LINES = 3;
/** Above this many comparison cells the diff falls back to a whole-block replacement. */
const MAX_LCS_CELLS = 1_000_000;

interface SplitResult {
  lines: string[];
}

/**
 * Split content into display lines. Line endings are normalized for display only; the bytes written
 * to the repository are never touched by this module.
 */
function splitLines(content: string): SplitResult {
  if (content === "") {
    return { lines: [] };
  }
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return { lines: body.split("\n") };
}

type EditType = "context" | "add" | "delete";

interface EditOp {
  type: EditType;
  line: string;
  /** 0-based index into the original file. */
  aIndex: number;
  /** 0-based index into the new file. */
  bIndex: number;
}

/** Classic O(n*m) LCS backtracking over lines, after common prefix/suffix trimming. */
function computeEditScript(a: string[], b: string[]): EditOp[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const ops: EditOp[] = [];

  for (let i = 0; i < prefix; i += 1) {
    ops.push({ type: "context", line: a[i], aIndex: i, bIndex: i });
  }

  if (aMid.length * bMid.length > MAX_LCS_CELLS) {
    aMid.forEach((line, i) => ops.push({ type: "delete", line, aIndex: prefix + i, bIndex: prefix }));
    bMid.forEach((line, i) => ops.push({ type: "add", line, aIndex: a.length - suffix, bIndex: prefix + i }));
  } else {
    const table: number[][] = Array.from({ length: aMid.length + 1 }, () => new Array<number>(bMid.length + 1).fill(0));
    for (let i = aMid.length - 1; i >= 0; i -= 1) {
      for (let j = bMid.length - 1; j >= 0; j -= 1) {
        table[i][j] = aMid[i] === bMid[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < aMid.length && j < bMid.length) {
      if (aMid[i] === bMid[j]) {
        ops.push({ type: "context", line: aMid[i], aIndex: prefix + i, bIndex: prefix + j });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        ops.push({ type: "delete", line: aMid[i], aIndex: prefix + i, bIndex: prefix + j });
        i += 1;
      } else {
        ops.push({ type: "add", line: bMid[j], aIndex: prefix + i, bIndex: prefix + j });
        j += 1;
      }
    }
    while (i < aMid.length) {
      ops.push({ type: "delete", line: aMid[i], aIndex: prefix + i, bIndex: prefix + j });
      i += 1;
    }
    while (j < bMid.length) {
      ops.push({ type: "add", line: bMid[j], aIndex: prefix + i, bIndex: prefix + j });
      j += 1;
    }
  }

  for (let k = 0; k < suffix; k += 1) {
    const aIdx = a.length - suffix + k;
    const bIdx = b.length - suffix + k;
    ops.push({ type: "context", line: a[aIdx], aIndex: aIdx, bIndex: bIdx });
  }

  return ops;
}

interface Hunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: string[];
}

/** Group changed lines into hunks with up to `CONTEXT_LINES` lines of context, merged when close. */
function buildHunks(ops: EditOp[]): Hunk[] {
  const changedIndexes = ops.map((op, index) => (op.type === "context" ? -1 : index)).filter((index) => index >= 0);
  if (changedIndexes.length === 0) {
    return [];
  }

  const ranges: [number, number][] = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, index + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = end;
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([start, end]) => {
    const slice = ops.slice(start, end + 1);
    const aStart = slice[0].aIndex;
    const bStart = slice[0].bIndex;
    const lines = slice.map((op) => {
      if (op.type === "add") return `+${op.line}`;
      if (op.type === "delete") return `-${op.line}`;
      return ` ${op.line}`;
    });
    return {
      aStart,
      aCount: slice.filter((op) => op.type !== "add").length,
      bStart,
      bCount: slice.filter((op) => op.type !== "delete").length,
      lines,
    };
  });
}

export interface DiffRequest {
  /** Repository-relative path of the new state, with leading slash. */
  path: string;
  /** Repository-relative path of the old state, or `null` when the file is new. */
  originalPath: string | null;
  originalContent: string | null;
  newContent: string | null;
  /** Maximum rendered diff lines; beyond it hunks are dropped and a truncation note is appended. */
  maxDiffLines: number;
}

function stripSlash(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

/**
 * Render a `git diff`-style unified diff for a single file.
 *
 * `null` content on one side means the file does not exist there (add / delete). A rename whose
 * content is unchanged yields a header-only diff.
 */
export function computeFileDiff(request: DiffRequest): FileDiff {
  const oldPath = request.originalPath;
  const newPath = request.path;
  const a = request.originalContent === null ? [] : splitLines(request.originalContent).lines;
  const b = request.newContent === null ? [] : splitLines(request.newContent).lines;
  const ops = computeEditScript(a, b);

  const header: string[] = [];
  if (oldPath !== null && oldPath !== newPath) {
    header.push(`diff --git a/${stripSlash(oldPath)} b/${stripSlash(newPath)}`);
    header.push(`rename from ${stripSlash(oldPath)}`);
    header.push(`rename to ${stripSlash(newPath)}`);
  } else {
    header.push(`diff --git a/${stripSlash(newPath)} b/${stripSlash(newPath)}`);
  }

  const additions = ops.filter((op) => op.type === "add").length;
  const deletions = ops.filter((op) => op.type === "delete").length;
  const hunks = buildHunks(ops);

  const body: string[] = [...header];
  const oldSide = oldPath !== null && oldPath !== newPath ? oldPath : newPath;
  body.push(`--- ${request.originalContent === null ? "/dev/null" : `a/${stripSlash(oldSide)}`}`);
  body.push(`+++ ${request.newContent === null ? "/dev/null" : `b/${stripSlash(newPath)}`}`);

  let omittedHunks = 0;
  for (const hunk of hunks) {
    const projected = body.length + hunk.lines.length + 1;
    if (projected > request.maxDiffLines) {
      omittedHunks += 1;
      continue;
    }
    body.push(`@@ -${hunk.aStart + 1},${hunk.aCount} +${hunk.bStart + 1},${hunk.bCount} @@`);
    body.push(...hunk.lines);
  }

  if (omittedHunks > 0) {
    body.push(`… ${omittedHunks} further hunk(s) not shown — diff truncated at ${request.maxDiffLines} lines`);
  }

  return {
    path: newPath,
    originalPath: oldPath !== null && oldPath !== newPath ? oldPath : undefined,
    diff: body.join("\n"),
    additions,
    deletions,
  };
}
