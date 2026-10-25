import { useCallback, useEffect, useMemo, useState } from "react";
import { listProjects, listRepositories, listWritableRepositoryIds } from "../../../infrastructure/repoClient";
import { mapWithConcurrency } from "../../../utils/concurrency";
import { RepoTarget } from "../../../domain/types";
import { getErrorMessage } from "../../../utils/errorUtils";

/** A repository row in the selector: the target plus the project it belongs to. */
export interface RepoRow {
  target: RepoTarget;
  /** Set on the placeholder row of a project whose repositories could not be listed. */
  error?: string;
  /**
   * Whether the user has Contribute (write) access on this repository. `false` means the user can only 
   * read it and the row stays visible but unselectable; `undefined` means the access probe was unavailable,
   * so the row keeps the previous behavior and remains selectable.
   */
  canContribute?: boolean;
}

/** How many projects' repository lists are fetched at once. */
const PROJECT_CONCURRENCY = 6;

export interface ScopeState {
  /** Every repository the user can read, sorted by project then repository name. */
  repoRows: RepoRow[];
  loading: boolean;
  error: string | null;
  selectedRepoIds: string[];
  /** Selected repositories the bulk run will operate on. */
  targets: RepoTarget[];
  toggleRepo: (repositoryId: string) => void;
  setAllRepos: (selected: boolean) => void;
  reload: () => void;
}

/** A row can be selected when it is a real repository and Contribute access is not known to be missing. */
function isSelectable(row: RepoRow): boolean {
  return row.target.repositoryId !== "" && row.canContribute !== false;
}

/**
 * Loads every repository the signed-in user can access and tracks the selection.
 *
 * The user picks repositories directly — there is no project step. Projects are fetched only to enumerate
 * accessible projects, then each project's repositories are listed once (bounded concurrency) and merged
 * into one flat, sorted list. Because every repository is present up front, the dropdown filter box matches
 * across all of them at once, which makes filtering far more useful than narrowing by project first.
 *
 * Listing is a *read* permission, so a following Contribute-access probe (the stable
 * `security/permissionevaluationbatch` route) marks which of those repositories the bulk run could
 * actually write to. Read-only repositories stay in the list but are never selectable, and a failed
 * probe leaves access unknown so nothing is hidden by mistake.
 */
export function useProjectRepos(): ScopeState {
  const [repoRows, setRepoRows] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const projects = (await listProjects())
        .map((project) => ({ id: project.id ?? "", name: project.name ?? "" }))
        .filter((project) => project.id !== "");

      // Fetch every project's repositories concurrently, capped so we never open hundreds of requests at once.
      const perProject = await mapWithConcurrency(
        projects,
        PROJECT_CONCURRENCY,
        async (project): Promise<RepoRow[]> => {
          try {
            const repositories = await listRepositories(project.id);
            return repositories.map((repository) => ({
              target: {
                projectId: project.id,
                projectName: project.name,
                repositoryId: repository.id,
                repositoryName: repository.name,
                defaultBranch: repository.defaultBranch ?? "refs/heads/main",
                webUrl: repository.webUrl,
              },
            }));
          } catch (err) {
            // Keep the project visible as a single error row so its failure is not silent.
            return [
              {
                target: {
                  projectId: project.id,
                  projectName: project.name,
                  repositoryId: "",
                  repositoryName: "",
                  defaultBranch: "",
                },
                error: getErrorMessage(err),
              },
            ];
          }
        },
      );

      const sorted = perProject.flat().sort((a, b) => {
        const byProject = a.target.projectName.localeCompare(b.target.projectName);
        if (byProject !== 0) {
          return byProject;
        }
        return a.target.repositoryName.localeCompare(b.target.repositoryName);
      });

      // The listing endpoint only proves read access; probe Contribute access so read-only repositories
      // can be greyed out in the selector instead of failing late with `push_denied`.
      const writable = await listWritableRepositoryIds(
        sorted
          .filter((row) => row.target.repositoryId !== "")
          .map((row) => ({ projectId: row.target.projectId, repositoryId: row.target.repositoryId })),
      );
      const rows =
        writable === null
          ? sorted
          : sorted.map((row) =>
              row.target.repositoryId === "" ? row : { ...row, canContribute: writable.has(row.target.repositoryId) },
            );
      setRepoRows(rows);
      // Drop selections that are no longer selectable (repository lost access or was removed on reload).
      const selectableIds = new Set(rows.filter(isSelectable).map((row) => row.target.repositoryId));
      setSelectedRepoIds((previous) => previous.filter((id) => selectableIds.has(id)));
    } catch (err) {
      // Projects themselves could not be listed — surface it and leave the list empty.
      setError(getErrorMessage(err));
      setRepoRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRepo = useCallback(
    (repositoryId: string): void => {
      setSelectedRepoIds((previous) => {
        if (previous.includes(repositoryId)) {
          // Removal is always allowed so a selection can never get stuck on a repository that lost
          // access after a reload.
          return previous.filter((id) => id !== repositoryId);
        }
        // Read-only repositories are visible but must never enter the selection.
        const row = repoRows.find((candidate) => candidate.target.repositoryId === repositoryId);
        if (!row || row.target.repositoryId === "" || row.canContribute === false) {
          return previous;
        }
        return [...previous, repositoryId].sort();
      });
    },
    [repoRows],
  );

  const setAllRepos = useCallback(
    (selected: boolean): void => {
      setSelectedRepoIds(
        selected
          ? repoRows
              .filter(isSelectable)
              .map((row) => row.target.repositoryId)
              .sort()
          : [],
      );
    },
    [repoRows],
  );

  const targets = useMemo(
    () =>
      repoRows
        .filter((row) => isSelectable(row) && selectedRepoIds.includes(row.target.repositoryId))
        .map((row) => row.target),
    [repoRows, selectedRepoIds],
  );

  return {
    repoRows,
    loading,
    error,
    selectedRepoIds,
    targets,
    toggleRepo,
    setAllRepos,
    reload: () => void load(),
  };
}
