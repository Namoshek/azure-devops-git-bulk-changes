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
import { RepoTarget } from "../src/domain/bulkChanges/types";
import { createRepoAccess } from "../src/infrastructure/azureDevOps/repoClient";

const client = {
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

  it("does not update the pull request when auto-complete is disabled", async () => {
    await expect(createRepoAccess().createPullRequest(target, { ...request, autoMerge: false })).resolves.toEqual({
      pullRequestId: 42,
    });

    expect(client.updatePullRequest).not.toHaveBeenCalled();
  });
});
