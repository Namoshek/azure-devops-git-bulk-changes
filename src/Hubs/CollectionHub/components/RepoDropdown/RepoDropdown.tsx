import React from "react";
import { DropdownBase } from "../../../../components/uiCompat";
import { useRepoSelectionSync } from "../../hooks/useRepoSelectionSync";
import { ScopeState } from "../../hooks/useProjectRepos";

/** A single multi-select over every accessible repository; its filter box matches across all projects. */
export function RepoDropdown({ scope }: { scope: ScopeState }) {
  const { items, selection } = useRepoSelectionSync(scope);
  const selectableCount = scope.repoRows.filter((row) => row.target.repositoryId).length;

  return (
    <DropdownBase
      items={items}
      selection={selection}
      showFilterBox
      showChecksColumn
      noItemsText="No Git repositories are visible to your account."
      filteredNoResultsText="No repositories match."
      placeholder="Select repositories"
      ariaLabel="Repositories"
      disabled={scope.loading || selectableCount === 0}
    />
  );
}
