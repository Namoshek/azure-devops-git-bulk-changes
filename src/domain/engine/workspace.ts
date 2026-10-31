import { BaseFile, DesiredChange } from "../types";
import { isInTree, isPathEqualIgnoreCase, normalizeGitPath, treePathsOverlap } from "./pathUtils";

/** A single file inside the virtual workspace. */
export interface WorkspaceFile {
  path: string;
  /** The base-commit path this entry originated from, or `null` when newly added. */
  originalPath: string | null;
  /** `null` for files that exist in Git but cannot be handled as text. */
  content: string | null;
  /** Why the content could not be read (binary, oversized, LFS, ...). */
  skipReason?: string;
  objectId: string | null;
  isBinary: boolean;
  /** True when this entry was created by an operation rather than read from Git. */
  synthesized: boolean;
}

export interface WorkspaceRename {
  from: string;
  to: string;
  collisions: string[];
}

/**
 * An in-memory copy of a repository's tracked files.
 *
 * Lookups are case-sensitive (Git paths are), but a case-insensitive collision is reported so the
 * engine can warn instead of silently creating a second file with the same name on Windows.
 */
export class VirtualWorkspace {
  private readonly files = new Map<string, WorkspaceFile>();

  private setRaw(path: string, file: WorkspaceFile): void {
    this.files.set(path, file);
  }

  /** Populate the workspace from the files read out of the base commit. */
  public static fromBaseFiles(baseFiles: BaseFile[]): VirtualWorkspace {
    const workspace = new VirtualWorkspace();
    for (const file of baseFiles) {
      workspace.setRaw(normalizeGitPath(file.path), {
        path: normalizeGitPath(file.path),
        originalPath: normalizeGitPath(file.path),
        content: file.content,
        skipReason: file.skipReason,
        objectId: file.objectId,
        isBinary: file.isBinary,
        synthesized: false,
      });
    }
    return workspace;
  }

  public get(path: string): WorkspaceFile | undefined {
    return this.files.get(normalizeGitPath(path));
  }

  public has(path: string): boolean {
    return this.files.has(normalizeGitPath(path));
  }

  public set(path: string, content: string, objectId: string | null = null, isBinary = false): WorkspaceFile {
    const normalized = normalizeGitPath(path);
    const existing = this.files.get(normalized);
    const file: WorkspaceFile = {
      path: normalized,
      originalPath: existing ? existing.originalPath : null,
      content,
      skipReason: undefined,
      objectId,
      isBinary,
      synthesized: existing ? existing.synthesized : true,
    };
    this.files.set(normalized, file);
    return file;
  }

  public remove(path: string): WorkspaceFile | undefined {
    const normalized = normalizeGitPath(path);
    const existing = this.files.get(normalized);
    this.files.delete(normalized);
    return existing;
  }

  /** Remove `path` and every file below it. Returns the removed paths, sorted. */
  public removeTree(path: string): string[] {
    const normalized = normalizeGitPath(path);
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const removed = [...this.files.keys()].filter(
      (candidate) => candidate === normalized || candidate.startsWith(prefix),
    );
    for (const candidate of removed) {
      this.files.delete(candidate);
    }
    return removed.sort();
  }

  /**
   * Move `from` to `to`, preserving content. Returns `false` when the source does not exist or the
   * target is already occupied.
   */
  public rename(from: string, to: string): boolean {
    const normalizedFrom = normalizeGitPath(from);
    const normalizedTo = normalizeGitPath(to);
    if (normalizedFrom === normalizedTo) {
      return false;
    }
    const source = this.files.get(normalizedFrom);
    if (!source || this.files.has(normalizedTo)) {
      return false;
    }
    this.files.delete(normalizedFrom);
    this.files.set(normalizedTo, {
      ...source,
      path: normalizedTo,
      originalPath: source.originalPath ?? normalizedFrom,
    });
    return true;
  }

  /** Move `from` and every file below it to `to`, preserving relative paths. */
  public renameTree(from: string, to: string): WorkspaceRename[] | null {
    const normalizedFrom = normalizeGitPath(from);
    const normalizedTo = normalizeGitPath(to);
    if (normalizedFrom === normalizedTo || treePathsOverlap(normalizedFrom, normalizedTo)) {
      return null;
    }

    const sourcePaths = this.paths().filter((candidate) => isInTree(candidate, normalizedFrom));
    const sourcePathSet = new Set(sourcePaths);
    const sameTreeIgnoringCase = normalizedFrom.toLowerCase() === normalizedTo.toLowerCase();
    const destinationOccupied = this.paths().some(
      (candidate) =>
        (isInTree(candidate, normalizedTo) || isInTree(candidate.toLowerCase(), normalizedTo.toLowerCase())) &&
        !(sameTreeIgnoringCase && sourcePathSet.has(candidate)),
    );
    if (sourcePaths.length === 0 || destinationOccupied) {
      return null;
    }

    const moves: Array<{ from: string; to: string; file: WorkspaceFile; collisions: string[] }> = [];
    for (const sourcePath of sourcePaths) {
      const file = this.files.get(sourcePath);
      if (!file) {
        return null;
      }

      const relativePath =
        sourcePath === normalizedFrom
          ? ""
          : sourcePath.slice(normalizedFrom === "/" ? 1 : normalizedFrom.length + 1);
      const targetPath = relativePath ? `${normalizedTo}/${relativePath}` : normalizedTo;
      moves.push({
        from: sourcePath,
        to: targetPath,
        file,
        collisions: this.caseInsensitiveCollisions(targetPath),
      });
    }

    if (new Set(moves.map((move) => move.to)).size !== moves.length || moves.some((move) => this.files.has(move.to))) {
      return null;
    }

    for (const move of moves) {
      this.files.delete(move.from);
    }
    for (const move of moves) {
      this.files.set(move.to, {
        ...move.file,
        path: move.to,
        originalPath: move.file.originalPath ?? move.from,
      });
    }

    return moves.map(({ from: sourcePath, to: targetPath, collisions }) => ({
      from: sourcePath,
      to: targetPath,
      collisions,
    }));
  }

  public paths(): string[] {
    return [...this.files.keys()].sort();
  }

  public all(): WorkspaceFile[] {
    return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Existing paths that differ from `path` only by case. Git allows both on Linux, but Azure Pipelines
   * and Windows workspaces treat them as the same file, so callers should warn.
   */
  public caseInsensitiveCollisions(path: string): string[] {
    const normalized = normalizeGitPath(path);
    return [...this.files.keys()].filter(
      (candidate) => candidate !== normalized && isPathEqualIgnoreCase(candidate, normalized),
    );
  }

  /**
   * Compare the workspace against the base commit and return the push changes.
   *
   * Files whose content and path are unchanged produce nothing, which makes re-running an idempotent
   * definition a no-op. A rename with changed content is emitted as a rename and edit so the push
   * mapper can choose an API-compatible representation.
   */
  public describeChanges(baseFiles: BaseFile[]): DesiredChange[] {
    const baseByPath = new Map<string, BaseFile>();
    for (const file of baseFiles) {
      baseByPath.set(normalizeGitPath(file.path), file);
    }

    const changes: DesiredChange[] = [];
    /** Base paths already consumed by a rename change. */
    const renamedFrom = new Set<string>();

    for (const file of this.all()) {
      const origin = file.originalPath;
      const baseAtOrigin = origin ? baseByPath.get(origin) : undefined;

      // A file that is no longer at its base path is a rename/move. The rename change itself does
      // not need content, so binary or unreadable files can be moved too.
      if (baseAtOrigin && origin !== file.path) {
        renamedFrom.add(origin as string);
        changes.push({
          kind: "rename",
          from: origin as string,
          to: file.path,
          content: file.content,
          baseObjectId: baseAtOrigin.objectId,
        });
        if (file.content !== null && file.content !== baseAtOrigin.content) {
          changes.push({ kind: "edit", path: file.path, content: file.content, baseObjectId: baseAtOrigin.objectId });
        }
        continue;
      }

      // Everything below rewrites content, which requires readable text.
      if (file.content === null) {
        continue;
      }

      const baseAtPath = baseByPath.get(file.path);
      if (baseAtPath) {
        if (baseAtPath.isBinary || baseAtPath.content === null) {
          continue;
        }
        if (baseAtPath.content !== file.content) {
          changes.push({ kind: "edit", path: file.path, content: file.content, baseObjectId: baseAtPath.objectId });
        }
        continue;
      }

      changes.push({ kind: "add", path: file.path, content: file.content });
    }

    for (const base of baseFiles) {
      const normalized = normalizeGitPath(base.path);
      if (!this.has(normalized) && !renamedFrom.has(normalized)) {
        changes.push({ kind: "delete", path: normalized, baseObjectId: base.objectId });
      }
    }

    return changes;
  }
}
