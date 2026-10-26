import { getClient } from "azure-devops-extension-api/Common/Client";
import * as SDK from "azure-devops-extension-sdk";
import { GitRestClient } from "azure-devops-extension-api/Git/GitClient";
import { CoreRestClient } from "azure-devops-extension-api/Core/CoreClient";
import { CommonServiceIds, ILocationService } from "azure-devops-extension-api/Common/CommonServices";
import * as Git from "azure-devops-extension-api/Git/Git";
import * as Core from "azure-devops-extension-api/Core/Core";
import { BaseFile, BulkChangeError, RepoTarget } from "../domain/types";
import { PullRequestRequest, PullRequestResult, PushRequest, PushResult, RepoAccess } from "../domain/repoAccess";
import { DEFAULT_DIRECTORY_SCAN_LIMIT, DEFAULT_TREE_SCAN_LIMIT } from "../domain/engine/planEngine";
import { mapWithConcurrency } from "../utils/concurrency";

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

function isBranchMissingError(err: unknown, branch: string): boolean {
  if (isNotFoundError(err)) {
    return true;
  }
  const message = serverMessage(err, "").toLowerCase();
  const branchName = shortBranchName(branch).toLowerCase();
  return message.includes(branchName) && /\bbranch\b.*\b(?:does not exist|not found)\b/.test(message);
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
 * Every file below `path` (at any depth), read with their content where possible.
 *
 * A listing larger than `limit` is rejected: a recursive delete must never act on a partial listing.
 * Content is loaded so the preview can show exactly what a recursive delete removes; files that
 * cannot be read as text (binary, oversized) stay content-less and render as header-only diffs.
 */
async function readTreeFiles(
  client: GitRestClient,
  target: RepoTarget,
  commit: string,
  path: string,
  limit: number,
  maxFileChars: number,
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
    const found = items.filter((item) => !item.isFolder && (item.path === path || item.path.startsWith(prefix)));
    if (found.length > limit) {
      throw new BulkChangeError(
        "tree_too_large",
        `${path} contains more than ${limit} files in ${target.repositoryName}; refusing to delete it.`,
      );
    }

    // Reuse the single-path reader: it flags binary and oversized files with their skip reasons.
    const read = await mapWithConcurrency(found, READ_CONCURRENCY, async (item) =>
      readItem(client, target, commit, item.path, maxFileChars),
    );
    return read.flatMap((file) => (file ? [file] : []));
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
        if (isBranchMissingError(err, branch)) {
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

      const treeSources = sourcePaths.filter((source) => source.kind === "tree");
      const trees = await mapWithConcurrency(treeSources, 4, async (source) =>
        readTreeFiles(client, target, commit, source.path, source.maxEntries ?? DEFAULT_TREE_SCAN_LIMIT, maxFileChars),
      );
      const treeFiles = trees.flat();

      // Tree reads now load content themselves, so literal paths already covered by a tree are not
      // fetched a second time.
      const treeRead = new Set(treeFiles.map((file) => file.path));
      const files = await mapWithConcurrency(
        [...wanted].filter((path) => !treeRead.has(path)),
        READ_CONCURRENCY,
        async (path) => readItem(client, target, commit, path, maxFileChars),
      );

      const byPath = new Map<string, BaseFile>();
      for (const file of treeFiles) {
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
          parents: commit.parents,
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

      const payload = {
        sourceRefName: request.sourceRefName,
        targetRefName: request.targetRefName,
        title: request.title,
        description: request.description,
        isDraft: request.isDraft,
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

      let autoCompleteWarning: string | undefined;
      if (request.autoMerge) {
        try {
          await client.updatePullRequest(
            {
              autoCompleteSetBy: { id: SDK.getUser().id },
              completionOptions: {
                autoCompleteIgnoreConfigIds: [],
                bypassPolicy: false,
              } as unknown as Git.GitPullRequestCompletionOptions,
            } as unknown as Git.GitPullRequest,
            target.repositoryId,
            created.pullRequestId,
            target.projectName,
          );
        } catch (err) {
          const fallbackMessage = isAccessError(err) ? "The request was denied." : "The update failed.";
          autoCompleteWarning = serverMessage(err, fallbackMessage);
        }
      }

      const result: PullRequestResult = { pullRequestId: created.pullRequestId };
      if (autoCompleteWarning) {
        result.autoCompleteWarning = autoCompleteWarning;
      }
      return result;
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
 * IMPORTANT: this lists what the caller may *read*, not what they may write — callers that intend to
 * modify repositories must additionally check Contribute access with `listWritableRepositoryIds`.
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

/** Requests per `security/permissionevaluationbatch` call. */
const PERMISSION_BATCH_SIZE = 100;

/** Low fan-out for permission probes: they accompany an already busy repository listing. */
const PERMISSION_BATCH_CONCURRENCY = 3;

/**
 * GUID of the "Source code repositories" security namespace, constant across every Azure DevOps
 * instance (cloud and on-premises alike).
 */
const GIT_SECURITY_NAMESPACE = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";

/**
 * Bitmask for Contribute access in the Git security namespace (GenericContribute = 4).
 *
 * This is the ACL flag the "Contribute" label in the Azure DevOps access-rights UI maps onto;
 * `vso.code_write` consent is required to ask about it, and `listRepositories` alone can only ever
 * prove read access.
 */
const GIT_CONTRIBUTE_PERMISSIONS = 4;

interface PermissionEvaluation {
  securityNamespaceId: string;
  token: string;
  permissions: number;
  /** Only present on the response of a successful evaluation. */
  value?: boolean;
}

/** Base URL of the current collection/organization, including any on-premises path prefix. */
async function collectionBaseUrl(): Promise<string> {
  const locationService = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
  const url = await locationService.getServiceLocation();
  return url.replace(/\/+$/, "");
}

/**
 * Evaluates a batch of security-namespace permission checks for the signed-in user.
 *
 * Uses the stable `POST {collection}/_apis/security/permissionevaluationbatch` route (api-version
 * 7.0, no preview flag), so it works on cloud *and* on-premises instances. The endpoint resolves the
 * caller itself from the bearer token — no user-descriptor lookup is needed. Throws on any HTTP error
 * so the caller can decide how to handle an unavailable probe.
 */
async function evaluatePermissionBatch(evaluations: PermissionEvaluation[]): Promise<boolean[]> {
  const [accessToken, baseUrl] = await Promise.all([SDK.getAccessToken(), collectionBaseUrl()]);
  if (!accessToken) {
    throw new BulkChangeError("not_authorized", "SDK.getAccessToken() returned an empty token.");
  }

  const response = await fetch(`${baseUrl}/_apis/security/permissionevaluationbatch?api-version=7.0`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ alwaysAllowAdministrators: true, evaluations }),
  });
  if (!response.ok) {
    throw new BulkChangeError("no_access", `permissionevaluationbatch returned ${response.status}.`);
  }

  const result = (await response.json()) as { evaluations?: PermissionEvaluation[] };
  const returned = result.evaluations ?? [];
  // Positional response: index i of `returned` answers index i of `evaluations`. A short or absent
  // list answers "denied" — the endpoint only omits an entry when it could not evaluate it.
  return evaluations.map((_, index) => returned[index]?.value === true);
}

/**
 * The subset of `repositories` on which the signed-in user has Contribute (write) access.
 *
 * Probes one `repoV2/<project>/<repo>` token per repository against the Git security namespace with
 * the Contribute bit, batched through `security/permissionevaluationbatch`. Returns `null` when the
 * probe could not be completed; callers must then treat access as unknown rather than denying, so a
 * repository is never hidden because the probe failed.
 */
export async function listWritableRepositoryIds(
  repositories: { projectId: string; repositoryId: string }[],
): Promise<Set<string> | null> {
  const valid = repositories.filter((repository) => repository.projectId !== "" && repository.repositoryId !== "");
  if (valid.length === 0) {
    return new Set<string>();
  }

  const chunks: { projectId: string; repositoryId: string }[][] = [];
  for (let start = 0; start < valid.length; start += PERMISSION_BATCH_SIZE) {
    chunks.push(valid.slice(start, start + PERMISSION_BATCH_SIZE));
  }

  const writable = new Set<string>();
  try {
    const perChunk = await mapWithConcurrency(
      chunks,
      PERMISSION_BATCH_CONCURRENCY,
      async (chunk: { projectId: string; repositoryId: string }[]): Promise<boolean[]> =>
        await evaluatePermissionBatch(
          chunk.map((repository) => ({
            securityNamespaceId: GIT_SECURITY_NAMESPACE,
            token: `repoV2/${repository.projectId}/${repository.repositoryId}`,
            permissions: GIT_CONTRIBUTE_PERMISSIONS,
          })),
        ),
    );
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const allowed = perChunk[chunkIndex];
      chunks[chunkIndex].forEach((repository, index) => {
        if (allowed[index]) {
          writable.add(repository.repositoryId);
        }
      });
    }
  } catch {
    // Probe unavailable (consent missing, route rejected, offline): fail open — never hide by mistake.
    return null;
  }
  return writable;
}
