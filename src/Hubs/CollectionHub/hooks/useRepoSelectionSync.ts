import { useEffect, useMemo, useRef } from "react";
import { IListBoxItem } from "azure-devops-ui/Components/ListBox/ListBox.Props";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { RepoRow, ScopeState } from "./useProjectRepos";

export interface RepoSelectionBinding {
  items: IListBoxItem<RepoRow>[];
  selection: DropdownMultiSelection;
}

/**
 * Binds the repository selection in `scope` to the dropdown's imperative selection object.
 *
 * React state is the source of truth and is pushed into the selection; user clicks are read back
 * through the selection subscription.
 */
export function useRepoSelectionSync(scope: ScopeState): RepoSelectionBinding {
  const selectionRef = useRef<DropdownMultiSelection>(new DropdownMultiSelection());
  const notifyRef = useRef<() => void>(() => undefined);
  // Suppresses notifications caused by pushing React state into the selection, so only genuine user
  // actions reach the state.
  const syncing = useRef(false);

  const items = useMemo<IListBoxItem<RepoRow>[]>(
    () =>
      scope.repoRows.map((row, index) => {
        const hasRepo = row.target.repositoryId !== "";
        const label = hasRepo ? `${row.target.projectName} / ${row.target.repositoryName}` : "(could not list)";
        return {
          id: row.target.repositoryId || `error-${row.target.projectId}-${index}`,
          text: label,
          ariaLabel: hasRepo ? label : "Repositories unavailable",
          disabled: !hasRepo,
          data: row,
        };
      }),
    [scope.repoRows],
  );
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Keep the reconciliation callback current so the subscription handler never closes over stale state.
  useEffect(() => {
    notifyRef.current = (): void => {
      const selectedIds = new Set(selectedItemIds(selectionRef.current, itemIds));
      for (const row of scope.repoRows) {
        const id = row.target.repositoryId;
        if (id && selectedIds.has(id) !== scope.selectedRepoIds.includes(id)) {
          scope.toggleRepo(id);
        }
      }
    };
  });

  useEffect(() => {
    const selection = selectionRef.current;
    const onChanged = (): void => {
      if (!syncing.current) {
        notifyRef.current();
      }
    };
    selection.subscribe(onChanged);
    return () => {
      selection.unsubscribe(onChanged);
    };
  }, []);

  useEffect(() => {
    syncing.current = true;
    applySelection(selectionRef.current, scope.selectedRepoIds, itemIds);
    syncing.current = false;
  }, [scope.selectedRepoIds, itemIds]);

  return { items, selection: selectionRef.current };
}

function selectedItemIds(selection: DropdownMultiSelection, itemIds: string[]): string[] {
  return itemIds.filter((_, index) => selection.selected(index));
}

/** Select the wanted ids and unselect the rest; index = position in the items array. */
function applySelection(selection: DropdownMultiSelection, wantedIds: string[], itemIds: string[]): void {
  const wanted = new Set(wantedIds);

  itemIds.forEach((id, index) => {
    const shouldSelect = wanted.has(id);
    if (shouldSelect && !selection.selected(index)) {
      selection.select(index, 1, true, true);
    } else if (!shouldSelect && selection.selected(index)) {
      selection.unselect(index);
    }
  });
}
