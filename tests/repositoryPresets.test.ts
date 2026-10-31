jest.mock("azure-devops-extension-sdk", () => ({
  getAccessToken: jest.fn(),
  getExtensionContext: jest.fn(),
  getService: jest.fn(),
}));
jest.mock("azure-devops-extension-api", () => ({
  CommonServiceIds: { ExtensionDataService: "extension-data-service" },
}));

import * as SDK from "azure-devops-extension-sdk";
import {
  createRepositoryPreset,
  deleteRepositoryPreset,
  getRepositoryPresets,
  MAX_REPOSITORY_PRESETS,
  updateRepositoryPreset,
} from "../src/services/repositoryPresets";

const manager = {
  getDocuments: jest.fn(),
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
};
const dataService = { getExtensionDataManager: jest.fn().mockResolvedValue(manager) };

describe("repository presets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SDK.getService as jest.Mock).mockResolvedValue(dataService);
    (SDK.getAccessToken as jest.Mock).mockResolvedValue("access-token");
    (SDK.getExtensionContext as jest.Mock).mockReturnValue({ id: "publisher.extension" });
    manager.getDocuments.mockResolvedValue([]);
    manager.createDocument.mockImplementation(async (_collection, document) => ({ id: "new-id", ...document }));
    manager.updateDocument.mockImplementation(async (_collection, document) => document);
    manager.deleteDocument.mockResolvedValue(undefined);
  });

  it("loads name-sorted presets from the user-scoped collection", async () => {
    manager.getDocuments.mockResolvedValue([
      { id: "z", name: "Zulu", repositoryIds: ["repo-z"] },
      { id: "a", name: "Alpha", repositoryIds: ["repo-a"] },
    ]);

    await expect(getRepositoryPresets()).resolves.toEqual([
      { id: "a", name: "Alpha", repositoryIds: ["repo-a"] },
      { id: "z", name: "Zulu", repositoryIds: ["repo-z"] },
    ]);
    expect(manager.getDocuments).toHaveBeenCalledWith("gitBulkChangesRepositoryPresets", {
      scopeType: "User",
      scopeValue: "Me",
    });
  });

  it("treats only a missing collection as empty presets", async () => {
    manager.getDocuments.mockRejectedValueOnce(new Error("Collection not found"));
    await expect(getRepositoryPresets()).resolves.toEqual([]);

    manager.getDocuments.mockRejectedValueOnce(new Error("Extension data service unavailable"));
    await expect(getRepositoryPresets()).rejects.toThrow("Extension data service unavailable");
  });

  it("creates normalized, unique presets and enforces the ten-preset limit", async () => {
    await expect(createRepositoryPreset("  Team repos  ", ["repo-b", "repo-a", "repo-b", ""])).resolves.toEqual({
      id: "new-id",
      name: "Team repos",
      repositoryIds: ["repo-a", "repo-b"],
    });
    expect(manager.createDocument).toHaveBeenCalledWith(
      "gitBulkChangesRepositoryPresets",
      { name: "Team repos", repositoryIds: ["repo-a", "repo-b"] },
      { scopeType: "User", scopeValue: "Me" },
    );

    manager.getDocuments.mockResolvedValue(
      Array.from({ length: MAX_REPOSITORY_PRESETS }, (_, index) => ({
        id: String(index),
        name: `Preset ${index}`,
        repositoryIds: [],
      })),
    );
    await expect(createRepositoryPreset("One more", [])).rejects.toThrow("You can have up to 10 repository presets.");
    expect(manager.createDocument).toHaveBeenCalledTimes(1);
  });

  it("updates and deletes presets in the same user-scoped collection", async () => {
    manager.getDocuments.mockResolvedValue([{ id: "preset-id", name: "Old name", repositoryIds: ["repo-a"] }]);

    await expect(updateRepositoryPreset("preset-id", "New name", ["repo-b"])).resolves.toEqual({
      id: "preset-id",
      name: "New name",
      repositoryIds: ["repo-b"],
    });
    expect(manager.updateDocument).toHaveBeenCalledWith(
      "gitBulkChangesRepositoryPresets",
      { id: "preset-id", name: "New name", repositoryIds: ["repo-b"] },
      { scopeType: "User", scopeValue: "Me" },
    );

    await deleteRepositoryPreset("preset-id");
    expect(manager.deleteDocument).toHaveBeenCalledWith(
      "gitBulkChangesRepositoryPresets",
      "preset-id",
      { scopeType: "User", scopeValue: "Me" },
    );
  });
});
