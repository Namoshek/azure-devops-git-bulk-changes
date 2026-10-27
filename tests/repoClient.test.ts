jest.mock("azure-devops-extension-api/Common", () => ({
  getClient: jest.fn(),
  CommonServiceIds: { LocationService: "LocationService" },
}));
jest.mock("azure-devops-extension-sdk", () => ({
  getUser: jest.fn(),
  getAccessToken: jest.fn(),
  getService: jest.fn(),
}));
jest.mock("azure-devops-extension-api/Git", () => ({
  GitRestClient: class GitRestClient {},
}));
jest.mock("azure-devops-extension-api/Core", () => ({
  CoreRestClient: class CoreRestClient {},
}));
jest.mock("azure-devops-extension-api/Git", () => ({}));
jest.mock("azure-devops-extension-api/Core", () => ({}));
// `readFiles` runs against these, so the constants it passes to the Git client have to exist.
jest.mock("azure-devops-extension-api/Git", () => ({
  VersionControlRecursionType: { None: 0, OneLevel: 1, Half: 2, Full: 3 },
  GitVersionType: { Commit: "commit" },
  GitVersionOptions: { None: 0 },
}));
jest.mock("azure-devops-extension-api/Core", () => ({}));

import * as SDK from "azure-devops-extension-sdk";
import { RepoTarget } from "../src/domain/types";
import type { PushRequest } from "../src/domain/repoAccess";
import { createRepoAccess, listWritableRepositoryIds } from "../src/infrastructure/repoClient";
import { getClient } from "azure-devops-extension-api/Common";

const client = {
  createPush: jest.fn(),
  getBranch: jest.fn(),
  createPullRequest: jest.fn(),
  updatePullRequest: jest.fn(),
};

const target: RepoTarget = {
  projectId: "project-id",
  projectName: "Project",
  repositoryId: "repository-id",
  repositoryName: "Repository",
  defaultBranch: "refs/heads/main",
  webUrl: "https://dev.example/Project/_git/Repository",
};

const request = {
  sourceRefName: "refs/heads/bulk-changes",
  targetRefName: "refs/heads/main",
  title: "Bulk change",
  description: "Apply changes",
  isDraft: false,
  autoMerge: true,
};

describe("createPullRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getClient as jest.Mock).mockReturnValue(client);
    (SDK.getUser as jest.Mock).mockReturnValue({ id: "user-id" });
    client.createPullRequest.mockResolvedValue({ pullRequestId: 42 });
    client.updatePullRequest.mockResolvedValue({ autoCompleteSetBy: { id: "user-id" } });
  });

  it("enables auto-complete after creation without bypassing any policies", async () => {
    await expect(createRepoAccess().createPullRequest(target, request)).resolves.toEqual({ pullRequestId: 42 });

    expect(client.createPullRequest).toHaveBeenCalledWith(
      {
        sourceRefName: request.sourceRefName,
        targetRefName: request.targetRefName,
        title: request.title,
        description: request.description,
        isDraft: request.isDraft,
      },
      target.repositoryId,
      target.projectName,
    );
    expect(client.updatePullRequest).toHaveBeenCalledWith(
      {
        autoCompleteSetBy: { id: "user-id" },
        completionOptions: { autoCompleteIgnoreConfigIds: [], bypassPolicy: false },
      },
      target.repositoryId,
      42,
      target.projectName,
    );
  });

  it("returns the created pull request with a warning when auto-complete setup fails", async () => {
    client.updatePullRequest.mockRejectedValueOnce(new Error("Policy update was rejected."));

    await expect(createRepoAccess().createPullRequest(target, request)).resolves.toEqual({
      pullRequestId: 42,
      autoCompleteWarning: "Policy update was rejected.",
    });
  });

  it("accepts a successful auto-complete update without the optional response field", async () => {
    client.updatePullRequest.mockResolvedValueOnce({});

    await expect(createRepoAccess().createPullRequest(target, request)).resolves.toEqual({ pullRequestId: 42 });
  });

  it("does not update the pull request when auto-complete is disabled", async () => {
    await expect(createRepoAccess().createPullRequest(target, { ...request, autoMerge: false })).resolves.toEqual({
      pullRequestId: 42,
    });

    expect(client.updatePullRequest).not.toHaveBeenCalled();
  });
});

describe("pushChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getClient as jest.Mock).mockReturnValue(client);
    client.createPush.mockResolvedValue({
      commits: [{ commitId: "new-commit" }],
      refUpdates: [{ newObjectId: "new-commit" }],
    });
  });

  it("passes the target commit as the parent when creating a source branch", async () => {
    const push: PushRequest = {
      refUpdates: [{ name: "refs/heads/improvements", oldObjectId: "0000000000000000000000000000000000000000" }],
      commits: [{ comment: "Create PR branch", parents: ["target-commit"], changes: [] }],
    };

    await expect(createRepoAccess().pushChanges(target, push)).resolves.toEqual({
      commitId: "new-commit",
      newObjectId: "new-commit",
    });
    expect(client.createPush).toHaveBeenCalledWith(
      {
        refUpdates: push.refUpdates,
        commits: [{ comment: "Create PR branch", parents: ["target-commit"], changes: [] }],
      },
      target.repositoryId,
      target.projectName,
    );
  });
});

describe("getBranchCommit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getClient as jest.Mock).mockReturnValue(client);
  });

  it("normalizes the server branch-not-found message", async () => {
    client.getBranch.mockRejectedValueOnce(new Error('Branch "improvements" does not exist in the repository.'));

    await expect(createRepoAccess().getBranchCommit(target, "improvements")).rejects.toMatchObject({
      code: "branch_missing",
    });
  });
});

describe("listWritableRepositoryIds", () => {
  const repositories = [
    { projectId: "project-a", repositoryId: "repo-a" },
    { projectId: "project-a", repositoryId: "repo-b" },
  ];
  const originalFetch = globalThis.fetch;
  let fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getClient as jest.Mock).mockReturnValue(client);
    (SDK.getAccessToken as jest.Mock).mockReturnValue("access-token");
    (SDK.getService as jest.Mock).mockReturnValue({
      getServiceLocation: jest.fn(async () => "https://contoso.com/Org/"),
    });
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts Contribute evaluations per repository and returns only the allowed ids", async () => {
    fetchMock.mockReturnValue({ ok: true, json: () => ({ evaluations: [{ value: true }, { value: false }] }) });

    const writable = await listWritableRepositoryIds(repositories);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toEqual("https://contoso.com/Org/_apis/security/permissionevaluationbatch?api-version=7.0");
    expect(JSON.parse((options as { body: string }).body)).toEqual({
      alwaysAllowAdministrators: true,
      evaluations: [
        {
          securityNamespaceId: "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87",
          token: "repoV2/project-a/repo-a",
          permissions: 4,
        },
        {
          securityNamespaceId: "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87",
          token: "repoV2/project-a/repo-b",
          permissions: 4,
        },
      ],
    });
    expect([...(writable ?? [])]).toEqual(["repo-a"]);
  });

  it("fails open when the security endpoint rejects the request", async () => {
    fetchMock.mockReturnValue({ ok: false, status: 401, json: () => ({}) });

    await expect(listWritableRepositoryIds(repositories)).resolves.toEqual(null as Set<string> | null);
  });
});

describe("readFiles", () => {
  const readClient = { getItems: jest.fn(), getItem: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (getClient as jest.Mock).mockReturnValue(readClient);
    readClient.getItem.mockReturnValue({ objectId: "sha-x", content: "x" });
  });

  it("resolves a pattern source by listing the scope and keeping only matching files", async () => {
    readClient.getItems.mockReturnValue([
      { path: "/src/a.ts", isFolder: false },
      { path: "/src/deep/b.ts", isFolder: false },
      { path: "/src/keep.md", isFolder: false },
      { path: "/src", isFolder: true },
    ]);

    const files = await createRepoAccess().readFiles(target, "base-sha", [
      { kind: "pattern", path: "/src/**/*.ts", maxEntries: 500 },
    ]);

    // The listing is scoped to the pattern's literal prefix, so the API call never asks for the root.
    expect(readClient.getItems.mock.calls[0][2]).toBe("/src");
    expect(files.map((file) => file.path)).toEqual(["/src/a.ts", "/src/deep/b.ts"]);
  });

  it("refuses a pattern over the cap instead of reading part of the matches", async () => {
    readClient.getItems.mockReturnValue([
      { path: "/src/a.ts", isFolder: false },
      { path: "/src/b.ts", isFolder: false },
      { path: "/src/c.ts", isFolder: false },
    ]);

    await expect(
      createRepoAccess().readFiles(target, "base-sha", [{ kind: "pattern", path: "/src/*.ts", maxEntries: 2 }]),
    ).rejects.toThrow(/above the 2 limit/);
    expect(readClient.getItem).not.toHaveBeenCalled();
  });
});
