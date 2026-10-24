/**
 * Core domain types for bulk Git changes.
 *
 * Everything in this module is transport-agnostic: no Azure DevOps SDK or REST
 * types are referenced here so the planning engine can be unit tested in isolation.
 */

/** Discriminator for the supported bulk operations. */
export type OperationKind = "add" | "delete" | "rename" | "replace";

/** What to do when a `replace` operation finds no match in a file. */
export type NoMatchBehavior = "error" | "skip" | "create-if-missing";

/** What to do when a `delete` or `rename` source path does not exist. */
export type MissingSourceBehavior = "error" | "skip";

export interface AddOperation {
  kind: "add";
  /** Repository-root-relative path, e.g. `/LICENSE`. */
  path: string;
  content: string;
  /** When true the file is only created if it does not exist yet. */
  onlyIfMissing: boolean;
}

export interface DeleteOperation {
  kind: "delete";
  path: string;
  onMissing: MissingSourceBehavior;
}

export interface RenameOperation {
  kind: "rename";
  /** Existing source path. */
  from: string;
  /** New target path. */
  to: string;
  onMissing: MissingSourceBehavior;
}

export interface ReplaceOperation {
  kind: "replace";
  path: string;
  /** Literal string or regular expression source, depending on `useRegex`. */
  find: string;
  /** Replacement text. May reference `$1`, `$&`, ... when `useRegex` is true. */
  replace: string;
  useRegex: boolean;
  /** Regex flags, only meaningful when `useRegex` is true. */
  flags: string;
  onNoMatch: NoMatchBehavior;
}

export type BulkOperation = AddOperation | DeleteOperation | RenameOperation | ReplaceOperation;

/** How a repository is written to. */
export type WriteMode = "directCommit" | "pullRequest";

/** The fully validated, normalized bulk change definition. */
export interface BulkChangeDefinition {
  operations: BulkOperation[];
  writeMode: WriteMode;
  /**
   * Explicit branch to operate on. `null` means "use each repository's default branch".
   * Only meaningful for `directCommit`; pull requests always target the default branch.
   */
  branch: string | null;
  /** Placeholder template for pull request / new branch names, e.g. `bulk-changes`. */
  branchName: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestDescription: string;
  pullRequestDraft: boolean;
}

/** A repository the user selected, with just enough metadata to act on it. */
export interface RepoTarget {
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  defaultBranch: string;
  /** Browser URL of the repository (`.../_git/<name>`), used to link to created commits and pull requests. */
  webUrl?: string;
}

/** A file as it exists (or existed) in the base commit. */
export interface BaseFile {
  path: string;
  /** Text content, or `null` when the file is binary / otherwise unreadable. */
  content: string | null;
  /** Git blob object id, used for change detection. `null` when the reader could not resolve it. */
  objectId: string | null;
  isBinary: boolean;
  /** Set when the reader deliberately did not load the content (too large, unreadable, ...). */
  skipReason?: string;
}

/**
 * A single change the engine wants to make in the base commit. The variants map one-to-one onto the
 * `GitPush` change types used by the Git REST API.
 */
export type DesiredChange =
  | { kind: "add"; path: string; content: string }
  | { kind: "edit"; path: string; content: string; baseObjectId: string | null }
  | { kind: "delete"; path: string; baseObjectId: string | null }
  | {
      kind: "rename";
      /** Base-commit path. */
      from: string;
      /** New path. */
      to: string;
      /** `null` when the file is binary and only the path changes. */
      content: string | null;
      baseObjectId: string | null;
    };

/** The per-repository outcome of planning the operation sequence. */
export type PlanStatus = "pending" | "running" | "would-change" | "no-change" | "skipped" | "error";

/** The per-repository outcome of applying the plan. */
export type ApplyStatus = "pending" | "running" | "committed" | "pr-created" | "failed" | "skipped";

/** Severity of a single operation result. */
export type OpSeverity = "applied" | "noop" | "warning" | "error";

export interface OpResult {
  /** Index of the operation in the definition. */
  index: number;
  kind: OperationKind;
  /** Primary path the operation acted on. */
  path: string;
  severity: OpSeverity;
  message: string;
}

/** A unified diff for one file. */
export interface FileDiff {
  path: string;
  /** Present for renames/moves. */
  originalPath?: string;
  /** `git diff`-style unified diff text. */
  diff: string;
  additions: number;
  deletions: number;
}

export interface RepoPlan {
  target: RepoTarget;
  /** Branch the plan was computed against. */
  branch: string;
  /** Commit the plan was computed against (the `oldObjectId` for the push). */
  baseCommit: string;
  status: PlanStatus;
  /** Short human-readable summary shown in the preview table. */
  message: string;
  opResults: OpResult[];
  /** Changes that would be pushed, in operation order. */
  desired: DesiredChange[];
  diffs: FileDiff[];
  /** Non-fatal findings (case collisions, skipped files, ...). */
  warnings: string[];
}

export interface ApplyResult {
  target: RepoTarget;
  status: ApplyStatus;
  message: string;
  /** Commit sha created by the push, when available. */
  commitId?: string;
  /** Pull request id, when the write mode is `pullRequest`. */
  pullRequestId?: number;
  /** Browser URL of the created commit or pull request. */
  link?: string;
}

/** Errors raised by the engine that are expected to surface to the user. */
export class BulkChangeError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BulkChangeError";
    this.code = code;
  }
}

/** Guard rails applied while planning a repository. */
export interface EngineLimits {
  /** Maximum file size (characters) the engine will read or rewrite. */
  maxFileChars: number;
  /** Maximum number of diff lines rendered per file. */
  maxDiffLines: number;
}

export const DEFAULT_LIMITS: EngineLimits = {
  maxFileChars: 1024 * 1024,
  maxDiffLines: 4000,
};

/**
 * A path the definition touches. Literal paths are read directly; directories are expanded to their
 * immediate children so operations can target well-known files without knowing which exist.
 */
export type SourcePath = { kind: "literal"; path: string } | { kind: "directory"; path: string; maxEntries?: number };

/** A snapshot of the files a definition touches, at a specific commit. */
export interface RepoSnapshot {
  commit: string;
  files: BaseFile[];
}
