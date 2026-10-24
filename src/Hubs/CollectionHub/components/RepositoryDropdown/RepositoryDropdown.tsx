import React from "react";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { DropdownBase, TwoLineCell } from "../../../../components/uiCompat";
import { useRepoSelectionSync } from "../../hooks/useRepoSelectionSync";
import { ScopeState } from "../../hooks/useProjectRepos";

/** A single multi-select over every accessible repository; its filter box matches across all projects. */
export function RepositoryDropdown({ scope }: { scope: ScopeState }) {
  const { items, selection } = useRepoSelectionSync(scope);
  const selectableCount = scope.repoRows.filter((row) => row.target.repositoryId).length;

  return (
    <DropdownBase
      items={items}
      selection={selection}
      renderItem={(_rowIndex, columnIndex, tableColumn, item) => (
        <TwoLineCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          tableCellClassName="bolt-table-cell-primary"
          line1={<EllipsisText>{item.data?.target.repositoryName || item.text || "(could not list)"}</EllipsisText>}
          line2={
            <EllipsisText className="secondary-text font-size-s">{item.data?.target.projectName ?? ""}</EllipsisText>
          }
        />
      )}
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
