import { BulkChangeError, DesiredChange } from "./types";
import { PushChange } from "./repoAccess";

/** Full ref name (`refs/heads/<branch>`) for a branch that may already be fully qualified. */
export function refName(branch: string): string {
  if (!branch) {
    throw new BulkChangeError("invalid_branch", "A branch name is required to write changes.");
  }
  return `refs/heads/${branch.replace(/^refs\/(heads\/)?/, "")}`;
}

/** `refUpdates` entry for a branch that must still point at `oldObjectId`. */
export function buildRefUpdate(branch: string, oldObjectId: string): { name: string; oldObjectId: string } {
  if (!oldObjectId) {
    throw new BulkChangeError("missing_base_commit", "The base commit of the target branch is unknown.");
  }
  return { name: refName(branch), oldObjectId };
}

/** Encode text content the way the Git push API expects it. */
function rawContent(content: string): { content: string; contentType: "rawtext" } {
  return { content, contentType: "rawtext" };
}

/**
 * Translate planned changes into the `changes` array of a single push commit.
 *
 * Ordering matters: renames must be applied before an edit of the renamed path, and deletions last, so
 * a definition that renames and then edits the same file works in one push.
 */
export function planToPushChanges(desired: DesiredChange[]): PushChange[] {
  const renames: PushChange[] = [];
  const content: PushChange[] = [];
  const deletions: PushChange[] = [];
  /** Last write wins when an operation sequence touches the same path twice. */
  const byPath = new Map<string, PushChange>();

  for (const change of desired) {
    switch (change.kind) {
      case "add":
        byPath.set(change.path, {
          changeType: "add",
          item: { path: change.path },
          newContent: rawContent(change.content),
        });
        break;
      case "edit":
        byPath.set(change.path, {
          changeType: "edit",
          item: { path: change.path },
          newContent: rawContent(change.content),
        });
        break;
      case "delete":
        byPath.set(change.path, { changeType: "delete", item: { path: change.path } });
        break;
      case "rename":
        renames.push({ changeType: "rename", sourceServerItem: change.from, item: { path: change.to } });
        if (change.content !== null) {
          byPath.set(change.to, {
            changeType: "edit",
            item: { path: change.to },
            newContent: rawContent(change.content),
          });
        }
        break;
    }
  }

  for (const change of byPath.values()) {
    if (change.changeType === "delete") {
      deletions.push(change);
    } else {
      content.push(change);
    }
  }

  return [...renames, ...content, ...deletions];
}
