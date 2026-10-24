import React, { useMemo } from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { ITableColumn, TableColumnLayout, TableColumnStyle } from "azure-devops-ui/Components/Table/Table.Props";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { ApplyResult, RepoPlan } from "../../../../domain/types";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { StatusLabel } from "../../../../components/StatusLabel/StatusLabel";
import { SimpleCell, TableBase, TwoLineCell } from "../../../../components/uiCompat";
import "./ResultsTable.css";

interface ResultsTableProps {
  plans: RepoPlan[];
  /** Apply results keyed by repository id; a repository with a result shows its apply outcome. */
  results: Map<string, ApplyResult>;
  /** Details are only available once planning finished; while reading, the message is enough. */
  interactive: boolean;
  onShowDetails: (repositoryId: string) => void;
}

const STATUS_RANK: Record<string, number> = {
  error: 0,
  "would-change": 1,
  "no-change": 2,
  skipped: 3,
  running: 4,
  pending: 5,
};

function sortPlans(plans: RepoPlan[]): RepoPlan[] {
  return [...plans].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.target.projectName.localeCompare(b.target.projectName) ||
      a.target.repositoryName.localeCompare(b.target.repositoryName),
  );
}

function resultLinkText(result: ApplyResult): string {
  return result.pullRequestId ? `Pull request !${result.pullRequestId}` : `Commit ${result.commitId?.slice(0, 8)}`;
}

function hasDetails(plan: RepoPlan): boolean {
  return plan.opResults.length > 0 || plan.diffs.length > 0 || plan.warnings.length > 0;
}

/** One row per repository: its preview outcome, replaced by the apply outcome once that exists. */
export function ResultsTable({ plans, results, interactive, onShowDetails }: ResultsTableProps) {
  // The table only re-renders rows when its item provider changes, so every input the cells read must invalidate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const itemProvider = useMemo(() => new ArrayItemProvider(sortPlans(plans)), [plans, results, interactive]);

  const columns: ITableColumn<RepoPlan>[] = [
    {
      id: "repo",
      name: "Repository",
      width: -30,
      readonly: true,
      columnLayout: TableColumnLayout.twoLine,
      columnStyle: TableColumnStyle.Primary,
      renderCell: (_row, columnIndex, tableColumn, plan, ariaRowIndex) => (
        <TwoLineCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          ariaRowIndex={ariaRowIndex}
          tableCellClassName="bolt-table-cell-primary"
          line1={<EllipsisText>{plan.target.repositoryName}</EllipsisText>}
          line2={
            <EllipsisText className="secondary-text monospaced-s">
              {plan.target.projectName} · {plan.branch}
            </EllipsisText>
          }
        />
      ),
    },
    {
      id: "status",
      name: "Status",
      width: 150,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, plan, ariaRowIndex) => {
        const result = results.get(plan.target.repositoryId);
        return (
          <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
            {result ? (
              <StatusLabel stage="apply" status={result.status} />
            ) : (
              <StatusLabel stage="preview" status={plan.status} />
            )}
          </SimpleCell>
        );
      },
    },
    {
      id: "files",
      name: "Files",
      width: 70,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, plan, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <span className="monospaced-s">{plan.desired.length || plan.diffs.length || "-"}</span>
        </SimpleCell>
      ),
    },
    {
      id: "message",
      name: "Details",
      width: -50,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, plan, ariaRowIndex) => {
        const result = results.get(plan.target.repositoryId);
        return (
          <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
            <div className="bc-result-message">
              <EllipsisText className="monospaced-s">{result ? result.message : plan.message}</EllipsisText>
              {result?.link ? (
                <a href={result.link} target="_blank" rel="noreferrer" className="bc-result-link">
                  {resultLinkText(result)}
                </a>
              ) : null}
            </div>
          </SimpleCell>
        );
      },
    },
    {
      id: "actions",
      name: "",
      ariaLabel: "Show details",
      width: 90,
      renderCell: (_row, columnIndex, tableColumn, plan, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          {interactive && hasDetails(plan) ? (
            <Button
              subtle
              text="Details"
              ariaLabel={`Show details for ${plan.target.repositoryName}`}
              onClick={() => onShowDetails(plan.target.repositoryId)}
            />
          ) : null}
        </SimpleCell>
      ),
    },
  ];

  return (
    <TableBase columns={columns} itemProvider={itemProvider} role="table" ariaLabel="Bulk change results" showLines />
  );
}
