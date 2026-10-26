/**
 * Core domain types for bulk Git changes.
 *
 * Everything in this module is transport-agnostic: no Azure DevOps SDK or REST
 * types are referenced here so the planning engine can be unit tested in isolation.
 */

/** Discriminator for the supported bulk operations. */
export type OperationKind = "add" | "addContent" | "applyPatch" | "delete" | "rename" | "replace";

/** What to do when an operation's target file does not exist. */
export type MissingFileBehavior = "error" | "skip" | "createIfMissing";

/** What to do when a `replace` operation finds no match in a file. */
export type NoMatchBehavior = MissingFileBehavior;

/** Where an `addContent` operation inserts its text. */
export type ContentPosition = "start" | "end" | "lineNumber";

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

export interface AddContentOperation {
  kind: "addContent";
  path: string;
  /** Inserted as whole lines. */
  content: string;
  position: ContentPosition;
  /** 1-based; the content is inserted before this line. Only used when `position` is `lineNumber`. */
  lineNumber: number | null;
  /** When true the operation is a no-op if the file already contains the content. */
  skipIfPresent: boolean;
  onFileMissing: MissingFileBehavior;
}

export interface ApplyPatchOperation {
  kind: "applyPatch";
  patch: string;
  /**
   * When true, file patches that cannot apply to this repository (missing source path, hunks that
   * do not match, taken destination) are skipped instead of failing the whole operation. The
   * operation still fails when no file patch applies at all, so nothing would be changed.
   */
  allowPartial: boolean;
}

export interface DeleteOperation {
  kind: "delete";
  path: string;
  /** When true `path` may be a directory, and everything below it is deleted. */
  recursive: boolean;
  onFileMissing: MissingSourceBehavior;
}

export interface RenameOperation {
  kind: "rename";
  /** Existing source path. */
  from: string;
  /** New target path. */
  to: string;
  onFileMissing: MissingSourceBehavior;
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

export type BulkOperation =
  | AddOperation
  | AddContentOperation
  | ApplyPatchOperation
  | DeleteOperation
  | RenameOperation
  | ReplaceOperation;

/** How a repository is written to. */
export type WriteMode = "directCommit" | "pullRequest";

/** The fully validated, normalized bulk change definition. */
export interface BulkChangeDefinition {
  operations: BulkOperation[];
  writeMode: WriteMode;
  /**
   * Target branch to operate on. `null` means "use each repository's default branch".
   * For `directCommit` the repository is read from and committed to this branch;
   * for `pullRequest` it is the base branch the pull request is merged into.
   */
  branch: string | null;
  commitMessage: string;
  pullRequest: {
    /** Placeholder template for pull request source branch names, e.g. `bulk-changes`. */
    branchName: string;
    title: string;
    description: string;
    draft: boolean;
    /** Enable Azure DevOps auto-complete after pull request requirements are satisfied. */
    autoMerge: boolean;
  };
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
export type SourcePath =
  | { kind: "literal"; path: string }
  | { kind: "directory"; path: string; maxEntries?: number }
  /** Every file below `path`, at any depth. Listing more than `maxEntries` files is an error, never a truncation. */
  | { kind: "tree"; path: string; maxEntries?: number };

/** A snapshot of the files a definition touches, at a specific commit. */
export interface RepoSnapshot {
  commit: string;
  files: BaseFile[];
}
