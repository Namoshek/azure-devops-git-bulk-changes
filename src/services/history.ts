import { ApplyResult } from "../domain/types";
import { getUserExtensionDataManager, USER_SCOPE } from "./extensionData";

const HISTORY_COLLECTION = "gitBulkChangesHistory";
const MAX_HISTORY_RECORDS = 100;

export interface BulkChangeHistoryRecord {
  id: string;
  timestamp: string;
  yamlText: string;
  results: ApplyResult[];
}

export function mostRecentHistory(records: BulkChangeHistoryRecord[]): BulkChangeHistoryRecord[] {
  return [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_HISTORY_RECORDS);
}

export async function getRecentBulkChangeHistory(): Promise<BulkChangeHistoryRecord[]> {
  try {
    const manager = await getUserExtensionDataManager();
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

  const manager = await getUserExtensionDataManager();
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
