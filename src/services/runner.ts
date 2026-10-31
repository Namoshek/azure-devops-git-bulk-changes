// Orchestration: preview (dry run) and apply across repositories.
import {
  ApplyResult,
  ApplyStatus,
  BulkChangeDefinition,
  BulkChangeError,
  EngineLimits,
  PlanStatus,
  RepoPlan,
  RepoSnapshot,
  RepoTarget,
  SourcePath,
} from "../domain/types";
import { collectSourcePaths, planRepository } from "../domain/engine/planEngine";
import { buildRefUpdate, planToPushChanges, refName } from "./pushChanges";
import { RepoAccess } from "../domain/repoAccess";
import { mapWithConcurrency } from "../utils/concurrency";
import { getErrorMessage } from "../utils/errorUtils";

const ZERO_OBJECT_ID = "0000000000000000000000000000000000000000";

/**
 * Branch a definition operates on for a given repository.
 *
 * In `directCommit` mode this is both the branch that is read and the branch that is committed to;
 * in `pullRequest` mode it is the base branch the pull request merges into. `null` falls back to
 * each repository's default branch.
 */
export function branchFor(definition: BulkChangeDefinition, target: RepoTarget): string {
  return definition.branch ?? target.defaultBranch;
}

function pullRequestSourceBranch(definition: BulkChangeDefinition): string {
  return definition.pullRequest.branchName.trim() || "bulk-changes";
}

async function ensurePullRequestSourceBranchDoesNotExist(
  access: RepoAccess,
  target: RepoTarget,
  sourceBranch: string,
): Promise<void> {
  try {
    await access.getBranchCommit(target, sourceBranch);
  } catch (err) {
    if (err instanceof BulkChangeError && err.code === "branch_missing") {
      return;
    }
    throw err;
  }

  throw new BulkChangeError(
    "pull_request_branch_exists",
    `Pull request source branch ${refName(sourceBranch)} already exists in ${target.repositoryName}; choose a different pullRequest.branchName.`,
  );
}

export interface RunOptions {
  limits?: EngineLimits;
  concurrency?: number;
  /** Progress callback, invoked with the plans/results known so far. */
  onProgress?: (partial: RepoPlan[] | ApplyResult[]) => void;
  /** Cooperative cancellation: checked before each repository starts. */
  isCancelled?: () => boolean;
}

/** Read the base commit and the touched files for one repository. */
async function readSnapshot(
  access: RepoAccess,
  target: RepoTarget,
  branch: string,
  sourcePaths: SourcePath[],
): Promise<RepoSnapshot> {
  const commit = await access.getBranchCommit(target, branch);
  const files = await access.readFiles(target, commit, sourcePaths);
  return { commit, files };
}

function emptyPlan(target: RepoTarget, branch: string, status: PlanStatus, message: string): RepoPlan {
  return { target, branch, baseCommit: "", status, message, opResults: [], desired: [], diffs: [], warnings: [] };
}

function emptyResult(target: RepoTarget, status: ApplyStatus, message: string): ApplyResult {
  return { target, status, message };
}

/** Browser page for a commit or pull request, or `undefined` when the repository's web URL is unknown. */
function webLink(target: RepoTarget, page: "commit" | "pullrequest", id: string | number): string | undefined {
  return target.webUrl ? `${target.webUrl.replace(/\/+$/, "")}/${page}/${id}` : undefined;
}

/**
 * Dry-run a definition across repositories.
 *
 * Each repository is read and planned independently; a failure in one repository is reported as an
 * `error` plan and never aborts the run.
 */
export async function previewRepos(
  access: RepoAccess,
  definition: BulkChangeDefinition,
  targets: RepoTarget[],
  options: RunOptions = {},
): Promise<RepoPlan[]> {
  const concurrency = options.concurrency ?? 5;
  const sourcePaths = collectSourcePaths(definition);

  // Keep a slot per target so partial progress arrives in selection order as repositories finish.
  const partial: RepoPlan[] = targets.map((target) =>
    emptyPlan(target, branchFor(definition, target), "pending", "Waiting to be read."),
  );
  const notify = (): void => {
    options.onProgress?.([...partial]);
  };

  await mapWithConcurrency(targets, concurrency, async (target, index): Promise<void> => {
    const branch = branchFor(definition, target);

    if (options.isCancelled?.()) {
      partial[index] = emptyPlan(target, branch, "skipped", "Cancelled before this repository was read.");
      notify();
      return;
    }

    try {
      const snapshot = await readSnapshot(access, target, branch, sourcePaths);
      const plan = planRepository(target, definition, snapshot, branch, {
        limits: options.limits,
        sourcePaths,
      }).plan;

      if (definition.writeMode === "pullRequest" && plan.status === "would-change") {
        try {
          await ensurePullRequestSourceBranchDoesNotExist(access, target, pullRequestSourceBranch(definition));
        } catch (err) {
          partial[index] = { ...plan, status: "error", message: getErrorMessage(err) };
          notify();
          return;
        }
      }

      partial[index] = plan;
    } catch (err) {
      partial[index] = emptyPlan(target, branch, "error", getErrorMessage(err));
    }
    notify();
  });

  return partial;
}

/**
 * Apply previously previewed plans.
 *
 * The branch tip is re-read at apply time so a stale preview cannot overwrite a newer commit: the push
 * uses the freshly read `oldObjectId`, while the change set comes from the preview.
 */
export async function applyRepos(
  access: RepoAccess,
  definition: BulkChangeDefinition,
  plans: RepoPlan[],
  options: RunOptions = {},
): Promise<ApplyResult[]> {
  const concurrency = options.concurrency ?? 5;

  // Same slot-per-plan pattern as previewRepos so results stream in as repositories finish.
  const partial: ApplyResult[] = plans.map((plan) => emptyResult(plan.target, "pending", "Waiting to be applied."));
  const notify = (): void => {
    options.onProgress?.([...partial]);
  };

  await mapWithConcurrency(plans, concurrency, async (plan, index): Promise<void> => {
    const { target } = plan;

    if (options.isCancelled?.()) {
      partial[index] = emptyResult(target, "skipped", "Cancelled before this repository was written.");
      notify();
      return;
    }

    if (plan.status === "error") {
      partial[index] = emptyResult(target, "failed", plan.message);
      notify();
      return;
    }
    if (plan.status !== "would-change" || plan.desired.length === 0) {
      partial[index] = emptyResult(target, "skipped", plan.message || "No changes to apply.");
      notify();
      return;
    }

    try {
      const baseCommit = await access.getBranchCommit(target, plan.branch);
      const changes = planToPushChanges(plan.desired);
      const commitMessage = definition.commitMessage || `Apply bulk changes (${plan.desired.length} file change(s))`;

      if (definition.writeMode === "directCommit") {
        const push = await access.pushChanges(target, {
          refUpdates: [buildRefUpdate(plan.branch, baseCommit)],
          commits: [{ comment: commitMessage, changes }],
        });
        partial[index] = {
          target,
          status: "committed",
          message: `Committed ${plan.desired.length} change(s) to ${plan.branch}.`,
          commitId: push.commitId,
          link: webLink(target, "commit", push.commitId),
        };
      } else {
        const sourceBranch = pullRequestSourceBranch(definition);
        await ensurePullRequestSourceBranchDoesNotExist(access, target, sourceBranch);

        const push = await access.pushChanges(target, {
          refUpdates: [buildRefUpdate(sourceBranch, ZERO_OBJECT_ID)],
          commits: [{ comment: commitMessage, parents: [baseCommit], changes }],
        });

        const pullRequest = await access.createPullRequest(target, {
          sourceRefName: refName(sourceBranch),
          targetRefName: refName(plan.branch),
          title: definition.pullRequest.title || commitMessage,
          description: definition.pullRequest.description,
          isDraft: definition.pullRequest.draft,
          autoMerge: definition.pullRequest.autoMerge,
        });
        const autoCompleteWarning = pullRequest.autoCompleteWarning
          ? ` Auto-complete could not be enabled: ${pullRequest.autoCompleteWarning}`
          : "";

        partial[index] = {
          target,
          status: "pr-created",
          message: `Created pull request !${pullRequest.pullRequestId} into ${plan.branch}.${autoCompleteWarning}`,
          commitId: push.commitId,
          pullRequestId: pullRequest.pullRequestId,
          link: webLink(target, "pullrequest", pullRequest.pullRequestId),
        };
      }
    } catch (err) {
      partial[index] = emptyResult(target, "failed", getErrorMessage(err));
    }
    notify();
  });

  return partial;
}
