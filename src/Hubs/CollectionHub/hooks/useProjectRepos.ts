import { useCallback, useEffect, useMemo, useState } from "react";
import { listProjects, listRepositories } from "../../../infrastructure/repoClient";
import { mapWithConcurrency } from "../../../utils/concurrency";
import { RepoTarget } from "../../../domain/types";
import { getErrorMessage } from "../../../utils/errorUtils";

/** A repository row in the selector: the target plus the project it belongs to. */
export interface RepoRow {
  target: RepoTarget;
  /** Set on the placeholder row of a project whose repositories could not be listed. */
  error?: string;
}

/** How many projects' repository lists are fetched at once. */
const PROJECT_CONCURRENCY = 6;

export interface ScopeState {
  /** All accessible repositories, sorted by project then repository name. */
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

/**
 * Loads every repository the signed-in user can access and tracks the selection.
 *
 * The user picks repositories directly — there is no project step. Projects are fetched only to enumerate
 * accessible projects, then each project's repositories are listed once (bounded concurrency) and merged
 * into one flat, sorted list. Because every repository is present up front, the dropdown filter box matches
 * across all of them at once, which makes filtering far more useful than narrowing by project first.
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

      const rows = perProject.flat().sort((a, b) => {
        const byProject = a.target.projectName.localeCompare(b.target.projectName);
        if (byProject !== 0) {
          return byProject;
        }
        return a.target.repositoryName.localeCompare(b.target.repositoryName);
      });
      setRepoRows(rows);
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

  const toggleRepo = useCallback((repositoryId: string): void => {
    setSelectedRepoIds((previous) =>
      previous.includes(repositoryId)
        ? previous.filter((id) => id !== repositoryId)
        : [...previous, repositoryId].sort(),
    );
  }, []);

  const setAllRepos = useCallback(
    (selected: boolean): void => {
      setSelectedRepoIds(
        selected
          ? repoRows
              .map((row) => row.target.repositoryId)
              .filter((id) => id !== "")
              .sort()
          : [],
      );
    },
    [repoRows],
  );

  const targets = useMemo(
    () => repoRows.filter((row) => selectedRepoIds.includes(row.target.repositoryId)).map((row) => row.target),
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
