import { applyPatch as applyUnifiedPatch, parsePatch } from "diff";
import type { StructuredPatch } from "diff";
import { ApplyPatchOperation, BulkChangeError, EngineLimits, OpResult } from "../types";
import { tryNormalizeGitPath } from "./pathUtils";
import { VirtualWorkspace } from "./workspace";

interface ParsedGitPatch {
  patch: StructuredPatch;
  oldPath: string | null;
  newPath: string | null;
  isCreate: boolean;
  isDelete: boolean;
  isRename: boolean;
  isCopy: boolean;
}

interface StagedPatch extends ParsedGitPatch {
  skipped: false;
  content: string;
  originalContent: string | null;
  renameCollisions: string[];
}

interface SkippedPatch {
  skipped: true;
  path: string;
  reason: string;
}

type PatchOutcome = StagedPatch | SkippedPatch;

function invalidPatch(message: string): never {
  throw new BulkChangeError("invalid_git_patch", message);
}

function pathFromHeader(fileName: string | undefined, side: "a" | "b", isGit: boolean): string | null {
  if (!fileName) {
    return invalidPatch("Each patch file must include old and new file headers.");
  }
  if (fileName === "/dev/null") {
    return null;
  }

  const path = isGit && fileName.startsWith(`${side}/`) ? fileName.slice(2) : fileName;
  const normalized = tryNormalizeGitPath(path);
  if (!normalized) {
    return invalidPatch(`Patch path "${fileName}" must stay inside the repository.`);
  }
  return normalized;
}

export function parseGitPatch(patchText: string): ParsedGitPatch[] {
  let patches: StructuredPatch[];
  try {
    patches = parsePatch(patchText);
  } catch (error) {
    return invalidPatch(`The Git patch is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (patches.length === 0) {
    return invalidPatch("The Git patch does not contain any file changes.");
  }

  const touchedPaths = new Set<string>();
  return patches.map((patch) => {
    if (patch.isBinary) {
      return invalidPatch("Binary Git patches are not supported; patches must contain text hunks.");
    }
    if (patch.oldMode && patch.newMode && patch.oldMode !== patch.newMode) {
      return invalidPatch("Git patches that change file modes are not supported.");
    }
    if (patch.isCreate && patch.newMode && patch.newMode !== "100644") {
      return invalidPatch("Only regular text files can be created by a Git patch.");
    }

    const isCreate = Boolean(patch.isCreate || patch.oldFileName === "/dev/null");
    const isDelete = Boolean(patch.isDelete || patch.newFileName === "/dev/null");
    const oldPath = isCreate ? null : pathFromHeader(patch.oldFileName, "a", Boolean(patch.isGit));
    const newPath = isDelete ? null : pathFromHeader(patch.newFileName, "b", Boolean(patch.isGit));
    const isRename = Boolean(patch.isRename);
    const isCopy = Boolean(patch.isCopy);

    if ((isCreate && isDelete) || (!oldPath && !newPath)) {
      return invalidPatch("Each Git patch must have a valid source or destination path.");
    }
    if ((isRename || isCopy) && (!oldPath || !newPath || oldPath === newPath)) {
      return invalidPatch("Git rename and copy patches must have distinct source and destination paths.");
    }
    if (oldPath && newPath && oldPath !== newPath && !isRename && !isCopy) {
      return invalidPatch("Changing a file path requires Git rename or copy metadata.");
    }
    if (patch.hunks.length === 0 && !isCreate && !isDelete && !isRename && !isCopy) {
      return invalidPatch("File-mode-only Git patches are not supported.");
    }

    for (const path of new Set([oldPath, newPath])) {
      if (path) {
        if (touchedPaths.has(path)) {
          return invalidPatch(`The Git patch changes "${path}" more than once.`);
        }
        touchedPaths.add(path);
      }
    }

    return { patch, oldPath, newPath, isCreate, isDelete, isRename, isCopy };
  });
}

export function getGitPatchPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const filePatch of parseGitPatch(patchText)) {
    if (filePatch.oldPath) paths.add(filePatch.oldPath);
    if (filePatch.newPath) paths.add(filePatch.newPath);
  }
  return [...paths];
}

export function applyGitPatch(
  workspace: VirtualWorkspace,
  operation: ApplyPatchOperation,
  index: number,
  limits: EngineLimits,
): OpResult {
  const patches = parseGitPatch(operation.patch);
  const partial = operation.allowPartial;

  // Each file patch either stages successfully, is skipped (partial mode only), or aborts the operation.
  const outcomes: PatchOutcome[] = patches.map((filePatch): PatchOutcome => {
    const { oldPath, newPath } = filePatch;
    const source = oldPath ? workspace.get(oldPath) : undefined;

    if (oldPath && !source) {
      if (partial) {
        return { skipped: true, path: oldPath, reason: "source file does not exist in this repository" };
      }
      return invalidPatch(`Patch source "${oldPath}" does not exist in this repository.`);
    }
    if (source?.content === null) {
      return invalidPatch(
        `Patch source "${oldPath}" cannot be read as text because ${source.skipReason ?? "its content is unavailable"}.`,
      );
    }
    if (newPath && newPath !== oldPath && workspace.has(newPath)) {
      if (partial) {
        return { skipped: true, path: newPath, reason: "destination already exists in this repository" };
      }
      return invalidPatch(`Patch destination "${newPath}" already exists in this repository.`);
    }

    const originalContent = source?.content ?? null;
    const content = applyUnifiedPatch(source?.content ?? "", filePatch.patch, { fuzzFactor: 0 });
    if (content === false) {
      if (partial) {
        return {
          skipped: true,
          path: oldPath ?? newPath ?? "patch",
          reason: "hunks do not match the current file content",
        };
      }
      return invalidPatch(`Patch hunks for "${oldPath ?? newPath}" do not match the current file content.`);
    }
    if (newPath && content.length > limits.maxFileChars) {
      return invalidPatch(
        `Patched file "${newPath}" would grow to ${content.length} characters, above the ${limits.maxFileChars} character limit.`,
      );
    }

    return {
      ...filePatch,
      skipped: false,
      content,
      originalContent,
      renameCollisions: filePatch.isRename && newPath ? workspace.caseInsensitiveCollisions(newPath) : [],
    };
  });

  const staged = outcomes.filter((outcome) => !outcome.skipped) as StagedPatch[];
  const skipped = outcomes.filter((outcome) => outcome.skipped) as SkippedPatch[];

  if (staged.length === 0) {
    const detail = skipped.map((skip) => `${skip.path} (${skip.reason})`).join("; ");
    return invalidPatch(
      partial
        ? `No file patch of this Git patch can be applied: ${detail}.`
        : "The Git patch cannot be applied to this repository: no file patch matches.",
    );
  }

  for (const filePatch of staged) {
    if (filePatch.newPath === null) {
      if (filePatch.oldPath) workspace.remove(filePatch.oldPath);
    } else if (filePatch.isRename && filePatch.oldPath) {
      workspace.rename(filePatch.oldPath, filePatch.newPath);
      workspace.set(filePatch.newPath, filePatch.content);
    } else {
      workspace.set(filePatch.newPath, filePatch.content);
    }
  }

  const changed = staged.some(
    (filePatch) =>
      filePatch.oldPath !== filePatch.newPath || filePatch.isCopy || filePatch.originalContent !== filePatch.content,
  );
  const renameCollisions = [...new Set(staged.flatMap((filePatch) => filePatch.renameCollisions))];
  // A single-file patch names its file; a multi-file patch has no one path to show, so leave the
  // path blank and let the per-file diffs carry the names.
  const resultPath = staged.length === 1 ? (staged[0].newPath ?? staged[0].oldPath ?? "patch") : "";

  if (skipped.length) {
    const detail = skipped.map((skip) => `${skip.path} (${skip.reason})`).join("; ");
    return {
      index,
      kind: "applyPatch",
      path: resultPath,
      severity: "warning",
      message: `Patch partially applied: ${staged.length} of ${patches.length} file(s) would change; skipped ${detail}.`,
    };
  }

  const message = changed
    ? `Patch would update ${staged.length} file(s).`
    : "The patch already matches the repository; no changes would be made.";

  return {
    index,
    kind: "applyPatch",
    path: resultPath,
    severity: renameCollisions.length ? "warning" : changed ? "applied" : "noop",
    message: renameCollisions.length
      ? `${message} Case-insensitive path collision: ${renameCollisions.join(", ")}.`
      : message,
  };
}
