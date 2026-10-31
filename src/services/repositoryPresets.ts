import { getUserExtensionDataManager, USER_SCOPE } from "./extensionData";

const REPOSITORY_PRESETS_COLLECTION = "gitBulkChangesRepositoryPresets";

export const MAX_REPOSITORY_PRESETS = 10;
export const MAX_REPOSITORY_PRESET_NAME_LENGTH = 100;

export interface RepositoryPreset {
  id: string;
  name: string;
  repositoryIds: string[];
}

export function sortRepositoryPresets(presets: RepositoryPreset[]): RepositoryPreset[] {
  return [...presets].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Preset name cannot be empty.");
  }
  if (normalized.length > MAX_REPOSITORY_PRESET_NAME_LENGTH) {
    throw new Error(`Preset name must be ${MAX_REPOSITORY_PRESET_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeRepositoryIds(repositoryIds: string[]): string[] {
  return [...new Set(repositoryIds.filter((repositoryId) => repositoryId.trim() !== ""))].sort();
}

function ensureUniqueName(name: string, presets: RepositoryPreset[], exceptId?: string): void {
  const normalizedName = name.toLowerCase();
  if (presets.some((preset) => preset.id !== exceptId && preset.name.trim().toLowerCase() === normalizedName)) {
    throw new Error(`A preset named "${name}" already exists.`);
  }
}

function isMissingCollectionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const candidate = err as { status?: number; message?: string; responseText?: string };
  return (
    candidate.status === 404 ||
    /collection not found/i.test(candidate.message ?? "") ||
    /collection not found/i.test(candidate.responseText ?? "")
  );
}

async function getStoredPresets(): Promise<RepositoryPreset[]> {
  const manager = await getUserExtensionDataManager();
  try {
    return (await manager.getDocuments(REPOSITORY_PRESETS_COLLECTION, USER_SCOPE)) as RepositoryPreset[];
  } catch (err) {
    if (isMissingCollectionError(err)) {
      return [];
    }
    throw err;
  }
}

export async function getRepositoryPresets(): Promise<RepositoryPreset[]> {
  return sortRepositoryPresets(await getStoredPresets());
}

export async function createRepositoryPreset(name: string, repositoryIds: string[]): Promise<RepositoryPreset> {
  const normalizedName = normalizeName(name);
  const normalizedRepositoryIds = normalizeRepositoryIds(repositoryIds);
  const manager = await getUserExtensionDataManager();
  const documents = await getStoredPresets();

  if (documents.length >= MAX_REPOSITORY_PRESETS) {
    throw new Error(`You can have up to ${MAX_REPOSITORY_PRESETS} repository presets.`);
  }
  ensureUniqueName(normalizedName, documents);

  return (await manager.createDocument(
    REPOSITORY_PRESETS_COLLECTION,
    { name: normalizedName, repositoryIds: normalizedRepositoryIds },
    USER_SCOPE,
  )) as RepositoryPreset;
}

export async function updateRepositoryPreset(
  id: string,
  name: string,
  repositoryIds: string[],
): Promise<RepositoryPreset> {
  const normalizedName = normalizeName(name);
  const normalizedRepositoryIds = normalizeRepositoryIds(repositoryIds);
  const manager = await getUserExtensionDataManager();
  const documents = await getStoredPresets();
  const existing = documents.find((preset) => preset.id === id);

  if (!existing) {
    throw new Error("Preset no longer exists. Reload presets and try again.");
  }
  ensureUniqueName(normalizedName, documents, id);

  return (await manager.updateDocument(
    REPOSITORY_PRESETS_COLLECTION,
    { ...existing, name: normalizedName, repositoryIds: normalizedRepositoryIds },
    USER_SCOPE,
  )) as RepositoryPreset;
}

export async function deleteRepositoryPreset(id: string): Promise<void> {
  const manager = await getUserExtensionDataManager();
  await manager.deleteDocument(REPOSITORY_PRESETS_COLLECTION, id, USER_SCOPE);
}
