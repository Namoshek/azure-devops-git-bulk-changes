import { getClient } from "azure-devops-extension-api/Common/Client";
import * as SDK from "azure-devops-extension-sdk";
import { GitRestClient } from "azure-devops-extension-api/Git/GitClient";
import { CoreRestClient } from "azure-devops-extension-api/Core/CoreClient";
import * as Git from "azure-devops-extension-api/Git/Git";
import * as Core from "azure-devops-extension-api/Core/Core";
import { BaseFile, BulkChangeError, RepoTarget } from "./types";
import { PullRequestRequest, PullRequestResult, PushRequest, PushResult, RepoAccess } from "./repoAccess";
import { DEFAULT_DIRECTORY_SCAN_LIMIT, DEFAULT_TREE_SCAN_LIMIT } from "./planEngine";
import { mapWithConcurrency } from "./concurrency";

/** Repository file reads are fanned out with this many requests per repository. */
const READ_CONCURRENCY = 8;

/** How many projects to request per page when enumerating the organization. */
const PROJECT_PAGE_SIZE = 200;

/** A ref update as returned by the server, including fields the typed model omits. */
interface RawRefUpdate {
  name?: string;
  newObjectId?: string;
  oldObjectId?: string;
  status?: string;
  customMessage?: string;
  error?: string;
}

export interface RepoClientOptions {
  /** Files larger than this are reported as unreadable instead of pulled into memory. */
  maxFileChars?: number;
}

function gitClient(): GitRestClient {
  return getClient(GitRestClient);
}

function coreClient(): CoreRestClient {
  return getClient(CoreRestClient);
}

/** `refs/heads/main` -> `main`, which is what the Git branch endpoints expect. */
function shortBranchName(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}

function commitVersion(commit: string): Git.GitVersionDescriptor {
  return { version: commit, versionType: Git.GitVersionType.Commit, versionOptions: Git.GitVersionOptions.None };
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 404;
}

/** The caller has no permission for the repository, or it does not exist. */
function isAccessError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 403 || status === 404 || status === 401;
}

function serverMessage(err: unknown, fallback: string): string {
  const candidate = err as { responseText?: string; serverError?: { message?: string }; message?: string } | null;
  const message = candidate?.serverError?.message ?? candidate?.message;
  if (message) {
    return message;
  }
  const text = candidate?.responseText;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      return text.slice(0, 400);
    }
  }
  return fallback;
}

/**
 * Read one path at `commit`.
 *
 * A missing path resolves to `undefined` rather than throwing: repositories legitimately differ in which
 * files they contain, and the engine turns a missing path into a per-operation result.
 */
async function readItem(
  client: GitRestClient,
  target: RepoTarget,
  commit: string,
  path: string,
  maxFileChars: number,
): Promise<BaseFile | undefined> {
  try {
    const item = await client.getItem(
      target.repositoryId,
      path,
      target.projectName,
      undefined,
      Git.VersionControlRecursionType.None,
      true,
      false,
      false,
      commitVersion(commit),
      true,
    );

    if (item.isFolder) {
      return undefined;
    }

    const objectId = item.objectId ?? item.originalObjectId ?? "";
    const metadata = item.contentMetadata;
    if (metadata?.isBinary || metadata?.encoding === -1) {
      return { path, content: null, objectId, isBinary: true, skipReason: "the file is binary" };
    }

    const content = item.content ?? "";
    if (content.length > maxFileChars) {
      return {
        path,
        content: null,
        objectId,
        isBinary: false,
        skipReason: `the file is larger than ${maxFileChars} characters`,
      };
    }

    return { path, content, objectId, isBinary: false };
  } catch (err) {
    if (isNotFoundError(err)) {
      return undefined;
    }
    if (isAccessError(err)) {
      throw new BulkChangeError("no_access", serverMessage(err, `No access to ${path} in ${target.repositoryName}.`));
    }
    throw err;
  }
}

/** Immediate children of a directory at `commit`, without their content. */
async function readDirectoryEntries(
  client: GitRestClient,
  target: RepoTarget,
  commit: string,
  path: string,
  limit: number,
): Promise<string[]> {
  try {
    const items = await client.getItems(
      target.repositoryId,
      target.projectName,
      path,
      Git.VersionControlRecursionType.OneLevel,
      true,
      false,
      false,
      false,
      commitVersion(commit),
    );

    const prefix = path === "/" ? "/" : `${path}/`;
    return items
      .filter((item) => !item.isFolder && item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes("/"))
      .map((item) => item.path)
      .slice(0, limit);
  } catch (err) {
    if (isNotFoundError(err)) {
      return [];
    }
    if (isAccessError(err)) {
      throw new BulkChangeError("no_access", serverMessage(err, `No access to ${path} in ${target.repositoryName}.`));
    }
    throw err;
  }
}

/**
 * Every file below `path` (at any depth), listed without content.
 *
 * A listing larger than `limit` is rejected: a recursive delete must never act on a partial listing.
 */
async function readTreeFiles(
  client: GitRestClient,
  target: RepoTarget,
  commit: string,
  path: string,
  limit: number,
): Promise<BaseFile[]> {
  try {
    const items = await client.getItems(
      target.repositoryId,
      target.projectName,
      path,
      Git.VersionControlRecursionType.Full,
      false,
      false,
      false,
      false,
      commitVersion(commit),
    );

    const prefix = path === "/" ? "/" : `${path}/`;
    const files = items.filter((item) => !item.isFolder && (item.path === path || item.path.startsWith(prefix)));
    if (files.length > limit) {
      throw new BulkChangeError(
        "tree_too_large",
        `${path} contains more than ${limit} files in ${target.repositoryName}; refusing to delete it.`,
      );
    }

    return files.map((item) => ({
      path: item.path,
      content: null,
      objectId: item.objectId ?? null,
      isBinary: false,
      skipReason: "its content was not loaded",
    }));
  } catch (err) {
    if (isNotFoundError(err)) {
      return [];
    }
    if (isAccessError(err)) {
      throw new BulkChangeError("no_access", serverMessage(err, `No access to ${path} in ${target.repositoryName}.`));
    }
    throw err;
  }
}

/**
 * Azure DevOps implementation of `RepoAccess`.
 *
 * Every call runs in the browser with the signed-in user's OAuth token, so permissions are enforced by
 * the server: a repository the user cannot see never appears in the listings, and writes fail with the
 * server's own permission message when the user lacks Contribute on the branch.
 */
export function createRepoAccess(options: RepoClientOptions = {}): RepoAccess {
  const maxFileChars = options.maxFileChars ?? 1024 * 1024;

  return {
    async getBranchCommit(target, branch): Promise<string> {
      const client = gitClient();
      try {
        const stats = await client.getBranch(target.repositoryId, shortBranchName(branch), target.projectName);
        const commit = stats?.commit?.commitId;
        if (!commit) {
          throw new BulkChangeError("no_commit", `${target.repositoryName} has no commit on ${branch}.`);
        }
        return commit;
      } catch (err) {
        if (isNotFoundError(err)) {
          throw new BulkChangeError("branch_missing", `Branch ${branch} does not exist in ${target.repositoryName}.`);
        }
        if (isAccessError(err)) {
          throw new BulkChangeError("no_access", serverMessage(err, `No access to ${target.repositoryName}.`));
        }
        throw err;
      }
    },

    async readFiles(target, commit, sourcePaths): Promise<BaseFile[]> {
      const client = gitClient();

      // Directories are expanded first so literal paths inside them are not fetched twice.
      const directoryPaths = sourcePaths.filter((source) => source.kind === "directory");
      const literalPaths = sourcePaths.filter((source) => source.kind === "literal").map((source) => source.path);

      const extraPaths = await mapWithConcurrency(directoryPaths, 4, async (source) => {
        const directory = source.path;
        const limit = source.maxEntries ?? DEFAULT_DIRECTORY_SCAN_LIMIT;
        return readDirectoryEntries(client, target, commit, directory, limit);
      });

      const wanted = new Set<string>(literalPaths);
      for (const paths of extraPaths) {
        for (const path of paths) {
          wanted.add(path);
        }
      }

      const treePaths = sourcePaths.filter((source) => source.kind === "tree");
      const trees = await mapWithConcurrency(treePaths, 4, async (source) =>
        readTreeFiles(client, target, commit, source.path, source.maxEntries ?? DEFAULT_TREE_SCAN_LIMIT),
      );

      const files = await mapWithConcurrency([...wanted], READ_CONCURRENCY, async (path) =>
        readItem(client, target, commit, path, maxFileChars),
      );

      // Files read with their content win over the content-less tree listing of the same path.
      const byPath = new Map<string, BaseFile>();
      for (const file of trees.flat()) {
        byPath.set(file.path, file);
      }
      for (const file of files) {
        if (file) {
          byPath.set(file.path, file);
        }
      }

      return [...byPath.values()];
    },

    async pushChanges(target, push: PushRequest): Promise<PushResult> {
      const client = gitClient();

      const payload = {
        refUpdates: push.refUpdates,
        commits: push.commits.map((commit) => ({
          comment: commit.comment,
          changes: commit.changes.map((change) => ({
            changeType: toChangeType(change.changeType),
            item: { path: change.item.path },
            sourceServerItem: change.sourceServerItem,
            newContent: change.newContent
              ? { content: change.newContent.content, contentType: toContentType(change.newContent.contentType) }
              : undefined,
          })),
        })),
      } as unknown as Git.GitPush;

      let result: Git.GitPush;
      try {
        result = await client.createPush(payload, target.repositoryId, target.projectName);
      } catch (err) {
        if (isAccessError(err)) {
          throw new BulkChangeError(
            "push_denied",
            serverMessage(
              err,
              `Cannot write to ${target.repositoryName}: the branch may be protected or you lack Contribute permission.`,
            ),
          );
        }
        throw err;
      }

      const update = (result?.refUpdates as unknown as RawRefUpdate[] | undefined)?.[0];
      if (update?.status && update.status.toLowerCase() !== "succeeded") {
        throw new BulkChangeError(
          "push_rejected",
          update.customMessage ?? update.error ?? `The push to ${update.name ?? "the branch"} was rejected.`,
        );
      }

      const commitId = result?.commits?.[0]?.commitId ?? "";
      const newObjectId = update?.newObjectId ?? commitId;
      if (!commitId) {
        throw new BulkChangeError("push_failed", `The push to ${target.repositoryName} created no commit.`);
      }

      return { commitId, newObjectId };
    },

    async createPullRequest(target, request: PullRequestRequest): Promise<PullRequestResult> {
      const client = gitClient();
      const autoCompleteSetBy = request.autoMerge ? { id: SDK.getUser().id } : undefined;

      const payload = {
        sourceRefName: request.sourceRefName,
        targetRefName: request.targetRefName,
        title: request.title,
        description: request.description,
        isDraft: request.isDraft,
        autoCompleteSetBy,
      } as unknown as Git.GitPullRequest;

      let created: Git.GitPullRequest;
      try {
        created = await client.createPullRequest(payload, target.repositoryId, target.projectName);
      } catch (err) {
        if (isAccessError(err)) {
          throw new BulkChangeError(
            "pull_request_denied",
            serverMessage(err, `Cannot create a pull request in ${target.repositoryName}.`),
          );
        }
        throw err;
      }

      if (!created?.pullRequestId) {
        throw new BulkChangeError("pull_request_failed", `No pull request was created in ${target.repositoryName}.`);
      }

      return { pullRequestId: created.pullRequestId };
    },
  };
}

function toChangeType(changeType: "add" | "edit" | "delete" | "rename"): Git.VersionControlChangeType {
  switch (changeType) {
    case "add":
      return Git.VersionControlChangeType.Add;
    case "edit":
      return Git.VersionControlChangeType.Edit;
    case "delete":
      return Git.VersionControlChangeType.Delete;
    case "rename":
      return Git.VersionControlChangeType.Rename;
  }
}

function toContentType(contentType: "rawtext" | "base64encoded"): Git.ItemContentType {
  return contentType === "base64encoded" ? Git.ItemContentType.Base64Encoded : Git.ItemContentType.RawText;
}

/** Projects the signed-in user can access, paged. */
export async function listProjects(): Promise<Core.TeamProjectReference[]> {
  const client = coreClient();
  const projects: Core.TeamProjectReference[] = [];
  let token: string | null = null;

  do {
    const page = await client.getProjects(
      undefined,
      PROJECT_PAGE_SIZE,
      undefined,
      token === null ? undefined : Number(token),
    );
    projects.push(...page);
    token = page.continuationToken ?? null;
  } while (token !== null);

  return projects;
}

/**
 * Git repositories of a project the signed-in user can access.
 *
 * Uses the stable `GET {project}/_apis/git/Repositories` contract, whose documented requirement is the
 * read-only `vso.code` scope. The newer paged variant is a preview route under a different controller
 * area and is rejected with 401 for delegated extension tokens, so it is deliberately not used.
 * The endpoint returns the repositories the caller may read, so no filtering by permission is needed.
 */
export async function listRepositories(projectId: string): Promise<Git.GitRepository[]> {
  const client = gitClient();
  try {
    const repositories = await client.getRepositories(projectId, false, false, false);
    return repositories.filter(
      (repository) => !repository.isDisabled && !repository.defaultBranch?.startsWith("tfvc://"),
    );
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 401) {
      throw new BulkChangeError(
        "not_authorized",
        "Azure DevOps rejected the request (401). The extension's `vso.code` consent is missing or stale: " +
          "open Organization settings > Extensions and re-authorize this extension, then retry.",
      );
    }
    if (status === 403) {
      throw new BulkChangeError(
        "no_access",
        serverMessage(err, `No permission to list repositories of this project (${projectId}).`),
      );
    }
    throw err;
  }
}

/** Map an API repository onto the engine's target shape. */
export function toRepoTarget(repository: Git.GitRepository): RepoTarget {
  return {
    projectId: repository.project?.id ?? "",
    projectName: repository.project?.name ?? "",
    repositoryId: repository.id,
    repositoryName: repository.name,
    defaultBranch: repository.defaultBranch ?? "refs/heads/main",
    webUrl: repository.webUrl,
  };
}
