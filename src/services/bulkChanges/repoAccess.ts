import { BaseFile, RepoTarget, SourcePath } from "../../domain/bulkChanges/types";

/** One entry of a `GitPush` change list, in the shape the REST API expects. */
export interface PushChange {
  changeType: "add" | "edit" | "delete" | "rename";
  item: { path: string };
  sourceServerItem?: string;
  newContent?: { content: string; contentType: "rawtext" | "base64encoded" };
}

export interface PushRequest {
  refUpdates: { name: string; oldObjectId: string }[];
  commits: { comment: string; changes: PushChange[] }[];
}

export interface PushResult {
  commitId: string;
  /** New tip of the updated ref. */
  newObjectId: string;
}

export interface PullRequestRequest {
  sourceRefName: string;
  targetRefName: string;
  title: string;
  description: string;
  isDraft: boolean;
  /** Enable Azure DevOps auto-complete after pull request requirements are satisfied. */
  autoMerge: boolean;
}

export interface PullRequestResult {
  pullRequestId: number;
}

/**
 * The storage contract the engine needs. Implemented by `repoClient.ts` over the Azure DevOps REST API
 * and by stubs in tests, so the runner and engine never touch the SDK.
 */
export interface RepoAccess {
  /** Tip commit of a branch. Rejects when the branch or repository is not accessible. */
  getBranchCommit(target: RepoTarget, branch: string): Promise<string>;
  /**
   * Read the given source paths at `commit`, resolving directories to their immediate children.
   * Paths that do not exist are simply omitted (not an error); files that exist but cannot be read as
   * text come back with `content: null` and a `skipReason`.
   */
  readFiles(target: RepoTarget, commit: string, sourcePaths: SourcePath[]): Promise<BaseFile[]>;
  pushChanges(target: RepoTarget, push: PushRequest): Promise<PushResult>;
  createPullRequest(target: RepoTarget, request: PullRequestRequest): Promise<PullRequestResult>;
}
