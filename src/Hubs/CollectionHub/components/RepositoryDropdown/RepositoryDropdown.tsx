import React from "react";
import { Icon } from "azure-devops-ui/Icon";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { DropdownBase, TwoLineCell } from "../../../../components/uiCompat";
import { useRepoSelectionSync } from "../../hooks/useRepoSelectionSync";
import { isSelectable, RepoRow } from "../../hooks/useProjectRepos";

interface RepositoryDropdownProps {
  repoRows: RepoRow[];
  selectedRepoIds: string[];
  onSelectionChange: (repositoryIds: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/** A single multi-select over every accessible repository; its filter box matches across all projects. */
export function RepositoryDropdown({
  repoRows,
  selectedRepoIds,
  onSelectionChange,
  disabled = false,
  ariaLabel = "Repositories",
}: RepositoryDropdownProps) {
  const { items, selection } = useRepoSelectionSync(repoRows, selectedRepoIds, onSelectionChange);
  // Read-only repositories are listed but cannot be selected, so only writable rows count here.
  const selectableCount = repoRows.filter(isSelectable).length;

  return (
    <DropdownBase
      items={items}
      selection={selection}
      renderItem={(_rowIndex, columnIndex, tableColumn, item) => (
        <TwoLineCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          tableCellClassName="bolt-table-cell-primary"
          line1={
            <>
              <EllipsisText>{item.data?.target.repositoryName || item.text || "(could not list)"}</EllipsisText>
              {item.data?.canContribute === false ? (
                <Icon
                  className="padding-left-4 cursor-pointer"
                  iconName="Lock"
                  ariaLabel="No write access"
                  tooltipProps={{ text: "You have no write access to this repository, so it cannot be selected." }}
                  style={{ color: "var(--status-warning-text)" }}
                />
              ) : null}
            </>
          }
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
      ariaLabel={ariaLabel}
      disabled={disabled || selectableCount === 0}
    />
  );
}
