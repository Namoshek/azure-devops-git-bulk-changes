jest.mock("../src/infrastructure/repoClient", () => ({
  listProjects: jest.fn(),
  listRepositories: jest.fn(),
  listWritableRepositoryIds: jest.fn(),
}));

import { act, renderHook, waitFor } from "@testing-library/react";
import type { TeamProjectReference } from "azure-devops-extension-api/Core";
import type { GitRepository } from "azure-devops-extension-api/Git";
import { listProjects, listRepositories, listWritableRepositoryIds } from "../src/infrastructure/repoClient";
import { useProjectRepos } from "../src/Hubs/CollectionHub/hooks/useProjectRepos";

const mockListProjects = listProjects as jest.MockedFunction<typeof listProjects>;
const mockListRepositories = listRepositories as jest.MockedFunction<typeof listRepositories>;
const mockListWritableRepositoryIds = listWritableRepositoryIds as jest.MockedFunction<
  typeof listWritableRepositoryIds
>;

describe("useProjectRepos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListProjects.mockResolvedValue([{ id: "project-id", name: "Project" } as TeamProjectReference]);
    mockListRepositories.mockResolvedValue([
      { id: "writable-repo", name: "Writable" } as GitRepository,
      { id: "read-only-repo", name: "Read only" } as GitRepository,
    ]);
    mockListWritableRepositoryIds.mockResolvedValue(new Set(["writable-repo"]));
  });

  it("only selects repositories that remain manually selectable", async () => {
    const { result } = renderHook(() => useProjectRepos());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.selectRepos(["writable-repo", "read-only-repo", "removed-repo"]));

    expect(result.current.selectedRepoIds).toEqual(["writable-repo"]);
  });
});
