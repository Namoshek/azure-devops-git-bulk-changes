import {
  BulkChangeDefinition,
  BulkChangeError,
  DEFAULT_LIMITS,
  DesiredChange,
  EngineLimits,
  FileDiff,
  OpResult,
  RepoPlan,
  RepoSnapshot,
  RepoTarget,
  SourcePath,
} from "../types";
import { computeFileDiff } from "./diff";
import { applyOperation } from "./operations";
import { normalizeGitPath } from "./pathUtils";
import { getGitPatchPaths } from "./gitPatch";
import { matchesPathPattern } from "./pathUtils";
import { VirtualWorkspace } from "./workspace";

/** Default number of entries pulled in when an operation targets a directory. */
export const DEFAULT_DIRECTORY_SCAN_LIMIT = 50;

/** Most files a recursive delete may cover; a larger tree is rejected rather than partially deleted. */
export const DEFAULT_TREE_SCAN_LIMIT = 1000;

/** Most files a path pattern may select; beyond it the repository is refused, like a tree scan. */
export const DEFAULT_GLOB_SCAN_LIMIT = 500;

/**
 * The paths a definition touches.
 *
 * Literal paths are read directly. A path whose first segment is an existing directory is expanded to
 * that directory's immediate children, so an operation can target a well-known file (e.g. `/build.cfg`)
 * without knowing in advance which repositories contain it. A `pathPattern` becomes a `pattern` source:
 * the definition alone cannot enumerate it, so the repository reader resolves it against a listing.
 */
export function collectSourcePaths(
  definition: BulkChangeDefinition,
  maxEntries = DEFAULT_DIRECTORY_SCAN_LIMIT,
): SourcePath[] {
  const paths: SourcePath[] = [];

  for (const op of definition.operations) {
    switch (op.kind) {
      case "add":
        paths.push({ kind: "literal", path: normalizeGitPath(op.path) });
        break;
      case "addContent":
      case "replace":
      case "delete": {
        if (op.pathPattern) {
          paths.push({ kind: "pattern", path: op.pathPattern, maxEntries: DEFAULT_GLOB_SCAN_LIMIT });
          break;
        }
        if (op.path === null) {
          break;
        }
        const exactPath = normalizeGitPath(op.path);
        paths.push(
          op.kind === "delete" && op.recursive
            ? { kind: "tree", path: exactPath, maxEntries: DEFAULT_TREE_SCAN_LIMIT }
            : { kind: "literal", path: exactPath },
        );
        break;
      }
      case "applyPatch":
        for (const path of getGitPatchPaths(op.patch)) {
          paths.push({ kind: "literal", path });
        }
        break;
      case "rename":
        paths.push({ kind: "literal", path: normalizeGitPath(op.from) });
        paths.push({ kind: "literal", path: normalizeGitPath(op.to) });
        break;
    }
  }

  const unique = new Map<string, SourcePath>();
  for (const path of paths) {
    unique.set(`${path.kind}:${path.path}`, path);
  }

  const expanded: SourcePath[] = [];
  for (const path of unique.values()) {
    const segments = path.path.slice(1).split("/");
    if (segments.length > 1 && path.kind === "literal") {
      expanded.push({ kind: "directory", path: `/${segments[0]}`, maxEntries: maxEntries });
    }
    expanded.push(path);
  }

  return expanded;
}

export interface PlanOptions {
  limits?: EngineLimits;
  /** Paths to fetch; defaults to everything the definition touches. */
  sourcePaths?: SourcePath[];
}

/** A planning result that carries everything the runner needs, including the paths to read. */
export interface PlanRequest {
  sourcePaths: SourcePath[];
  plan: RepoPlan;
}

function baseByPath(snapshot: RepoSnapshot): Map<string, BaseFileEntry> {
  const map = new Map<string, BaseFileEntry>();
  for (const file of snapshot.files) {
    map.set(normalizeGitPath(file.path), {
      path: normalizeGitPath(file.path),
      content: file.content,
      objectId: file.objectId,
      isBinary: file.isBinary,
      skipReason: file.skipReason,
    });
  }
  return map;
}

interface BaseFileEntry {
  path: string;
  content: string | null;
  objectId: string | null;
  isBinary: boolean;
  skipReason?: string;
}

/**
 * Turn a base-commit snapshot into the files the engine can work with: literal paths that exist,
 * immediate children of the directories the definition touches, and everything a pattern selects.
 *
 * `readFiles` already resolved pattern sources into concrete files, so this only has to keep them;
 * both sides must agree or a matched file would look new to `describeChanges` and be pushed as an
 * add instead of an edit.
 */
function resolveBaseFiles(snapshot: RepoSnapshot, sourcePaths: SourcePath[]): BaseFileEntry[] {
  const byPath = baseByPath(snapshot);
  const resolved = new Map<string, BaseFileEntry>();

  for (const source of sourcePaths) {
    if (source.kind === "literal") {
      const entry = byPath.get(source.path);
      if (entry) {
        resolved.set(source.path, entry);
      }
      continue;
    }

    if (source.kind === "tree") {
      const root = source.path;
      const treePrefix = root === "/" ? "/" : `${root}/`;
      for (const entry of byPath.values()) {
        if (entry.path === root || entry.path.startsWith(treePrefix)) {
          resolved.set(entry.path, entry);
        }
      }
      continue;
    }

    if (source.kind === "pattern") {
      for (const entry of byPath.values()) {
        if (matchesPathPattern(source.path, entry.path)) {
          resolved.set(entry.path, entry);
        }
      }
      continue;
    }

    const prefix = source.path === "/" ? "/" : `${source.path}/`;
    let taken = 0;
    const limit = source.maxEntries ?? DEFAULT_DIRECTORY_SCAN_LIMIT;
    for (const entry of byPath.values()) {
      if (!entry.path.startsWith(prefix)) {
        continue;
      }
      // Only immediate children of the directory.
      if (entry.path.slice(prefix.length).includes("/")) {
        continue;
      }
      if (taken >= limit) {
        break;
      }
      resolved.set(entry.path, entry);
      taken += 1;
    }
  }

  return [...resolved.values()];
}

function buildDiffs(changes: DesiredChange[], base: Map<string, BaseFileEntry>, limits: EngineLimits): FileDiff[] {
  const contentByPath = new Map<string, string>();
  for (const change of changes) {
    if (change.kind === "add" || change.kind === "edit") {
      contentByPath.set(change.path, change.content);
    } else if (change.kind === "rename" && change.content !== null) {
      contentByPath.set(change.to, change.content);
    }
  }

  const diffs: FileDiff[] = [];
  const seen = new Set<string>();
  // A rename already carries the final content of its target path, so a later edit of that path must not
  // produce a second diff for the same file.
  const renameTargets = new Set<string>(
    changes.filter((change) => change.kind === "rename").map((change) => (change as { to: string }).to),
  );

  for (const change of changes) {
    switch (change.kind) {
      case "add": {
        diffs.push(
          computeFileDiff({
            path: change.path,
            originalPath: null,
            originalContent: null,
            newContent: change.content,
            maxDiffLines: limits.maxDiffLines,
          }),
        );
        break;
      }
      case "edit": {
        if (renameTargets.has(change.path)) {
          continue;
        }
        const baseEntry = base.get(change.path);
        diffs.push(
          computeFileDiff({
            path: change.path,
            originalPath: change.path,
            originalContent: baseEntry ? baseEntry.content : null,
            newContent: change.content,
            maxDiffLines: limits.maxDiffLines,
          }),
        );
        break;
      }
      case "delete": {
        const baseEntry = base.get(change.path);
        diffs.push(
          computeFileDiff({
            path: change.path,
            originalPath: change.path,
            originalContent: baseEntry ? baseEntry.content : null,
            newContent: null,
            maxDiffLines: limits.maxDiffLines,
          }),
        );
        break;
      }
      case "rename": {
        if (seen.has(`${change.from}->${change.to}`)) {
          continue;
        }
        seen.add(`${change.from}->${change.to}`);
        const baseEntry = base.get(change.from);
        const newContent = change.content ?? (baseEntry ? baseEntry.content : null);
        diffs.push(
          computeFileDiff({
            path: change.to,
            originalPath: change.from,
            originalContent: baseEntry ? baseEntry.content : null,
            newContent,
            maxDiffLines: limits.maxDiffLines,
          }),
        );
        break;
      }
    }
  }

  return diffs;
}

function summarize(status: RepoPlan["status"], opResults: OpResult[], warnings: string[]): string {
  const errors = opResults.filter((r) => r.severity === "error");
  if (errors.length) {
    return errors[0].message;
  }
  if (status === "no-change") {
    return "No changes: every operation is already satisfied in this repository.";
  }
  if (status === "skipped") {
    return warnings[0] ?? "Skipped: none of the targeted files could be processed.";
  }
  // Warning-severity operations still change the repository (a partially applied patch reports a
  // warning), so they count toward "would change" alongside plain applied ones.
  const changed = opResults.filter((r) => r.severity === "applied" || r.severity === "warning").length;
  return `${changed} operation(s) would change this repository.`;
}

/**
 * Plan one repository: apply the operations in memory and report what a push would contain.
 *
 * The function is pure — it never performs I/O. The caller supplies the base snapshot produced by
 * `collectSourcePaths` + the repository reader.
 */
export function planRepository(
  target: RepoTarget,
  definition: BulkChangeDefinition,
  snapshot: RepoSnapshot,
  branch: string,
  options: PlanOptions = {},
): PlanRequest {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const sourcePaths = options.sourcePaths ?? collectSourcePaths(definition);
  const baseFiles = resolveBaseFiles(snapshot, sourcePaths);
  const base = baseByPath({ ...snapshot, files: baseFiles });
  const workspace = VirtualWorkspace.fromBaseFiles(baseFiles);

  const opResults: OpResult[] = [];
  // Missing paths are already reported by the operation results (error / noop), so they are not
  // duplicated as warnings here.
  const warnings: string[] = [];

  definition.operations.forEach((op, index) => {
    const operationPath =
      "path" in op
        ? ((op as { path: string | null }).path ?? (op as { pathPattern: string | null }).pathPattern ?? "")
        : "from" in op
          ? op.from
          : op.kind === "applyPatch"
            ? "patch"
            : "";
    try {
      const result = applyOperation(workspace, op, index, { limits });
      opResults.push(result);
      if (result.severity === "warning") {
        warnings.push(result.message);
      }
    } catch (err) {
      if (err instanceof BulkChangeError) {
        opResults.push({
          index,
          kind: op.kind,
          path: operationPath,
          severity: "error",
          message: err.message,
        });
      } else {
        opResults.push({
          index,
          kind: op.kind,
          path: operationPath,
          severity: "error",
          message: `Operation ${index + 1} (${op.kind}) failed: ${String(err)}`,
        });
      }
    }
  });

  const hasError = opResults.some((r) => r.severity === "error");
  if (hasError) {
    return {
      sourcePaths,
      plan: {
        target,
        branch,
        baseCommit: snapshot.commit,
        status: "error",
        message: summarize("error", opResults, warnings),
        opResults,
        desired: [],
        diffs: [],
        warnings,
      },
    };
  }

  const changes = workspace.describeChanges(baseFiles);
  const status: RepoPlan["status"] = changes.length > 0 ? "would-change" : "no-change";

  return {
    sourcePaths,
    plan: {
      target,
      branch,
      baseCommit: snapshot.commit,
      status,
      message: summarize(status, opResults, warnings),
      opResults,
      desired: changes,
      diffs: changes.length ? buildDiffs(changes, base, limits) : [],
      warnings,
    },
  };
}
