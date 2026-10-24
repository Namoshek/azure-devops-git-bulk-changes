import React, { useEffect, useMemo, useRef } from "react";
import { Dropdown } from "azure-devops-ui/Components/Dropdown/Dropdown";
import { IDropdownProps } from "azure-devops-ui/Components/Dropdown/Dropdown.Props";
import { IListBoxItem } from "azure-devops-ui/Components/ListBox/ListBox.Props";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { FormItem } from "azure-devops-ui/Components/FormItem/FormItem";
import { MessageCard } from "azure-devops-ui/Components/MessageCard/MessageCard";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { asComponent } from "../../components/uiCompat";
import { RepoRow, ScopeState } from "./hooks/useProjectRepos";

/**
 * azure-devops-ui components are typed against the React version they declare as a peer dependency
 * (React 16), whose element type does not satisfy this project's React 19 `JSX.Element`. Casting to a
 * generic function component keeps the props checked while letting the element type resolve.
 */
const DropdownBase = Dropdown as unknown as <T>(props: IDropdownProps<T>) => React.ReactElement;
const FormItemBase = asComponent(FormItem);
const MessageCardBase = asComponent(MessageCard);

interface ScopeSelectorProps {
  scope: ScopeState;
}

/**
 * A single multi-select over every accessible repository. The project name prefixes each entry so it is
 * clear where a repository lives, and the filter box matches across all repositories at once.
 *
 * `azure-devops-ui` selection objects are imperative, so React state is the source of truth and the
 * selection object is synced from it; user clicks are read back through the selection subscription.
 */
export function ScopeSelector({ scope }: ScopeSelectorProps) {
  const repoSelectionRef = useRef<DropdownMultiSelection>(new DropdownMultiSelection());
  const notifyRef = useRef<() => void>(() => undefined);
  // Suppresses notifications caused by pushing React state into the selection, so only genuine user
  // actions reach the state.
  const syncing = useRef(false);

  // ListBox items require an id; repository ids double as reconciliation keys in the same order as items.
  const repoItems = useMemo<IListBoxItem<RepoRow>[]>(
    () =>
      scope.repoRows.map((row, index) => {
        const hasRepo = row.target.repositoryId !== "";
        // Prefix the project name so it is clear which project each repository belongs to.
        const text = hasRepo ? `${row.target.projectName} / ${row.target.repositoryName}` : "(could not list)";
        return {
          id: row.target.repositoryId || `error-${row.target.projectId}-${index}`,
          text,
          ariaLabel: hasRepo ? `${row.target.projectName} / ${row.target.repositoryName}` : "Repositories unavailable",
          disabled: !hasRepo,
          data: row,
        };
      }),
    [scope.repoRows],
  );
  const repoItemIds = useMemo(() => repoItems.map((item) => item.id), [repoItems]);

  // Keep the reconciliation callback current so the subscription handler never closes over stale state.
  useEffect(() => {
    notifyRef.current = (): void => {
      const repoIds = selectedIds(repoSelectionRef.current, repoItemIds);
      for (const row of scope.repoRows) {
        if (!row.target.repositoryId) {
          continue;
        }
        const shouldSelect = repoIds.includes(row.target.repositoryId);
        if (shouldSelect !== scope.selectedRepoIds.includes(row.target.repositoryId)) {
          scope.toggleRepo(row.target.repositoryId);
        }
      }
    };
  });

  useEffect(() => {
    const repoSelection = repoSelectionRef.current;
    const onChanged = (): void => {
      if (syncing.current) {
        return;
      }
      notifyRef.current();
    };
    repoSelection.subscribe(onChanged);
    return () => {
      repoSelection.unsubscribe(onChanged);
    };
  }, []);

  // Push React state into the selection object (index = position in the items array).
  useEffect(() => {
    syncing.current = true;
    applyIndices(repoSelectionRef.current, scope.selectedRepoIds, repoItemIds);
    syncing.current = false;
  }, [scope.selectedRepoIds, repoItemIds]);

  const selectableCount = scope.repoRows.filter((row) => row.target.repositoryId).length;

  return (
    <div className="bc-section">
      <div className="bc-section-title">Scope</div>
      {scope.error ? (
        <MessageCardBase severity={MessageCardSeverity.Error} role="alert">
          Could not load repositories: {scope.error} <Button subtle text="Retry" onClick={scope.reload} />
        </MessageCardBase>
      ) : null}

      <FormItemBase label="Repositories" className="rhythm-vertical-8">
        {scope.loading ? (
          <Spinner size={SpinnerSize.small} label="Loading repositories…" ariaLabel="Loading repositories" />
        ) : null}
        {scope.repoRows.some((row) => row.error) ? (
          <MessageCardBase severity={MessageCardSeverity.Warning} role="alert">
            Some projects could not be listed:{" "}
            {scope.repoRows
              .filter((row) => row.error)
              .map((row) => `${row.target.projectName || row.target.projectId}: ${row.error}`)
              .join("; ")}
          </MessageCardBase>
        ) : null}
        <DropdownBase
          items={repoItems}
          selection={repoSelectionRef.current}
          showFilterBox
          showChecksColumn
          noItemsText="No Git repositories are visible to your account."
          filteredNoResultsText="No repositories match."
          placeholder="Select repositories"
          ariaLabel="Repositories"
          disabled={scope.loading || selectableCount === 0}
        />
        <div className="bc-form-row rhythm-vertical-4">
          <Button subtle text="Select all" onClick={() => scope.setAllRepos(true)} disabled={selectableCount === 0} />
          <Button
            subtle
            text="Clear"
            onClick={() => scope.setAllRepos(false)}
            disabled={scope.selectedRepoIds.length === 0}
          />
        </div>
        <div className="bc-muted monospaced-s rhythm-vertical-4">
          {scope.selectedRepoIds.length} of {selectableCount} repositories selected
        </div>
      </FormItemBase>
    </div>
  );
}

function selectedIds(selection: DropdownMultiSelection, itemIds: string[]): string[] {
  const ids: string[] = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    if (selection.selected(index)) {
      ids.push(itemIds[index]);
    }
  }
  return ids;
}

/**
 * Reconcile an imperative selection with a list of ids: select newly chosen entries, unselect the rest.
 *
 * The caller sets `syncing` so the resulting subscription notifications are ignored — otherwise pushing
 * state into the selection would immediately be read back as a user action.
 */
function applyIndices(selection: DropdownMultiSelection, wantedIds: string[], itemIds: string[]): void {
  const wanted = new Set(wantedIds);

  for (let index = 0; index < itemIds.length; index += 1) {
    const shouldSelect = wanted.has(itemIds[index]);
    if (shouldSelect && !selection.selected(index)) {
      selection.select(index, 1, true, true);
    } else if (!shouldSelect && selection.selected(index)) {
      selection.unselect(index);
    }
  }
}
