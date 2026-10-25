jest.mock("azure-devops-extension-api/Common/Client", () => ({
  getClient: jest.fn(),
}));
jest.mock("azure-devops-extension-sdk", () => ({
  getUser: jest.fn(),
}));
jest.mock("azure-devops-extension-api/Git/GitClient", () => ({
  GitRestClient: class GitRestClient {},
}));
jest.mock("azure-devops-extension-api/Core/CoreClient", () => ({
  CoreRestClient: class CoreRestClient {},
}));
jest.mock("azure-devops-extension-api/Git/Git", () => ({}));
jest.mock("azure-devops-extension-api/Core/Core", () => ({}));

import { getClient } from "azure-devops-extension-api/Common/Client";
import * as SDK from "azure-devops-extension-sdk";
import { RepoTarget } from "../src/domain/types";
import type { PushRequest } from "../src/domain/repoAccess";
import { createRepoAccess } from "../src/infrastructure/repoClient";

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
