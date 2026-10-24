import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IExtensionDataManager, IExtensionDataService } from "azure-devops-extension-api";
import { ApplyResult } from "../domain/types";

const HISTORY_COLLECTION = "gitBulkChangesHistory";
const MAX_HISTORY_RECORDS = 100;
const USER_SCOPE = { scopeType: "User", scopeValue: "Me" };

export interface BulkChangeHistoryRecord {
  id: string;
  timestamp: string;
  yamlText: string;
  results: ApplyResult[];
}

let managerPromise: Promise<IExtensionDataManager> | null = null;

async function getManager(): Promise<IExtensionDataManager> {
  if (!managerPromise) {
    managerPromise = (async () => {
      const dataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
      const accessToken = await SDK.getAccessToken();
      return dataService.getExtensionDataManager(SDK.getExtensionContext().id, accessToken);
    })().catch((err) => {
      managerPromise = null;
      throw err;
    });
  }
  return managerPromise;
}

export function mostRecentHistory(records: BulkChangeHistoryRecord[]): BulkChangeHistoryRecord[] {
  return [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_HISTORY_RECORDS);
}

export async function getRecentBulkChangeHistory(): Promise<BulkChangeHistoryRecord[]> {
  try {
    const manager = await getManager();
    const documents = (await manager.getDocuments(HISTORY_COLLECTION, USER_SCOPE)) as BulkChangeHistoryRecord[];
    return mostRecentHistory(documents);
  } catch (err) {
    console.error("Failed to load bulk change history:", err);
    return [];
  }
}

export async function recordBulkChangeHistory(yamlText: string, results: ApplyResult[]): Promise<void> {
  if (results.length === 0) {
    return;
  }

  const manager = await getManager();
  await manager.createDocument(
    HISTORY_COLLECTION,
    { timestamp: new Date().toISOString(), yamlText, results },
    USER_SCOPE,
  );

  const documents = (await manager.getDocuments(HISTORY_COLLECTION, USER_SCOPE)) as BulkChangeHistoryRecord[];
  const staleRecords = [...documents].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(MAX_HISTORY_RECORDS);
  await Promise.all(
    staleRecords
      .filter((record) => Boolean(record.id))
      .map((record) => manager.deleteDocument(HISTORY_COLLECTION, record.id, USER_SCOPE)),
  );
}
