jest.mock("azure-devops-extension-sdk", () => ({
  getAccessToken: jest.fn(),
  getExtensionContext: jest.fn(),
  getService: jest.fn(),
}));
jest.mock("azure-devops-extension-api", () => ({
  CommonServiceIds: { ExtensionDataService: "extension-data-service" },
}));

import * as SDK from "azure-devops-extension-sdk";
import { BulkChangeHistoryRecord, mostRecentHistory } from "../src/services/history";
import { getRecentBulkChangeHistory } from "../src/services/history";

function record(index: number): BulkChangeHistoryRecord {
  return {
    id: String(index),
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    yamlText: `operations: ${index}`,
    results: [],
  };
}

describe("mostRecentHistory", () => {
  it("returns the newest 100 records in descending timestamp order without mutating the input", () => {
    const records = Array.from({ length: 105 }, (_, index) => record(index));
    const original = [...records];

    const recent = mostRecentHistory(records);

    expect(recent).toHaveLength(100);
    expect(recent[0].id).toBe("104");
    expect(recent[99].id).toBe("5");
    expect(records).toEqual(original);
  });

  it("treats a missing history collection as empty history", async () => {
    const manager = { getDocuments: jest.fn().mockRejectedValue(new Error("Collection not found")) };
    const dataService = { getExtensionDataManager: jest.fn().mockResolvedValue(manager) };
    (SDK.getService as jest.Mock).mockResolvedValue(dataService);
    (SDK.getAccessToken as jest.Mock).mockResolvedValue("access-token");
    (SDK.getExtensionContext as jest.Mock).mockReturnValue({ id: "publisher.extension" });

    await expect(getRecentBulkChangeHistory()).resolves.toEqual([]);
  });
});
