import React from "react";
import { Table, SimpleTableCell, TwoLineTableCell } from "azure-devops-ui/Components/Table/Table";
import {
  ITableProps,
  ColumnJustification,
  ITableColumn,
  TableColumnLayout,
  TableColumnStyle,
} from "azure-devops-ui/Components/Table/Table.Props";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { Dialog } from "azure-devops-ui/Components/Dialog/Dialog";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { ITooltipProps } from "azure-devops-ui/TooltipEx";
import { StatusPill } from "../../features/bulkChanges/statusUi";
import { ApplyResult, OpResult, RepoPlan } from "../../features/bulkChanges/types";
import { asComponent } from "../../components/uiCompat";
import { DiffView } from "./DiffView";
import { ContentSize } from "azure-devops-ui/Callout";

// azure-devops-ui is typed against the React 16 element type it declares as a peer dependency, which
// does not satisfy this project's React 19 `JSX.Element`. A generic function-component cast keeps the
// props checked while letting the element type resolve.
const TableBase = Table as unknown as <T>(props: ITableProps<T>) => React.ReactElement;
const DialogBase = asComponent(Dialog);
const TooltipBase = Tooltip as unknown as React.ComponentType<ITooltipProps>;

// A column's renderCell MUST return a table cell (<td>), because Table puts its return value directly
// inside the row's <tr>. Returning bare <div>/<span> makes the browser wrap those non-cell children in a
// single anonymous cell and lay them out in block flow, so the "columns" stack vertically — the broken
// preview we saw. SimpleTableCell / TwoLineTableCell produce the correct themed <td> markup.
interface ICellProps<T> {
  ariaRowIndex?: number;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  columnIndex: number;
  tableColumn?: ITableColumn<T>;
}
interface ITwoLineCellProps<T> {
  ariaRowIndex?: number;
  columnIndex: number;
  line1: React.ReactNode;
  line2: React.ReactNode;
  tableCellClassName?: string;
  tableColumn?: ITableColumn<T>;
}
const SimpleCell = SimpleTableCell as unknown as <T>(props: ICellProps<T>) => React.ReactElement;
const TwoLineCell = TwoLineTableCell as unknown as <T>(props: ITwoLineCellProps<T>) => React.ReactElement;

interface PreviewPanelProps {
  plans: RepoPlan[];
  /** Apply results keyed by repository id, present once a run has started. */
  results: Map<string, ApplyResult>;
  /** Repository ids whose detail dialog is open. */
  expanded: Set<string>;
  onToggleExpand: (repositoryId: string) => void;
  /** Rows are only expandable once planning finished; while reading, the message is enough. */
  interactive: boolean;
}

/**
 * Wraps truncated cell content in an overflow-only tooltip so the full text stays readable when the
 * column clips it with an ellipsis. The tooltip falls back to the anchor's inner text, so no `text`
 * prop is needed.
 */
function EllipsisCell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <TooltipBase overflowOnly showOnFocus>
      <div className="text-ellipsis monospaced-s">{children}</div>
    </TooltipBase>
  );
}

const STATUS_RANK: Record<string, number> = {
  error: 0,
  "would-change": 1,
  "no-change": 2,
  skipped: 3,
  running: 4,
  pending: 5,
};

function repoKey(plan: RepoPlan): string {
  return plan.target.repositoryId;
}

/** Preview table: one row per repository with its dry-run status, plus expandable details. */
export function PreviewPanel({ plans, results, expanded, onToggleExpand, interactive }: PreviewPanelProps) {
  const sorted = [...plans].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) {
      return rank;
    }
    return (
      a.target.projectName.localeCompare(b.target.projectName) ||
      a.target.repositoryName.localeCompare(b.target.repositoryName)
    );
  });

  const columns: ITableColumn<RepoPlan>[] = [
    {
      id: "repo",
      name: "Repository",
      width: -60,
      readonly: true,
      columnLayout: TableColumnLayout.twoLine,
      columnStyle: TableColumnStyle.Primary,
      renderCell: (_row, col, column, plan, ariaRowIndex) => (
        <TwoLineCell
          columnIndex={col}
          tableColumn={column}
          ariaRowIndex={ariaRowIndex}
          tableCellClassName="bolt-table-cell-primary"
          line1={
            <TooltipBase overflowOnly showOnFocus>
              <div className="text-ellipsis">{plan.target.repositoryName}</div>
            </TooltipBase>
          }
          line2={
            <TooltipBase overflowOnly showOnFocus>
              <div className="bc-muted monospaced-s text-ellipsis">
                {plan.target.projectName} · {plan.branch}
              </div>
            </TooltipBase>
          }
        />
      ),
    },
    {
      id: "status",
      name: "Status",
      width: 130,
      readonly: true,
      renderCell: (_row, col, column, plan, ariaRowIndex) => {
        const result = results.get(repoKey(plan));
        return (
          <SimpleCell columnIndex={col} tableColumn={column} ariaRowIndex={ariaRowIndex}>
            <StatusPill status={result ? result.status : plan.status} />
          </SimpleCell>
        );
      },
    },
    {
      id: "files",
      name: "Files",
      width: 70,
      readonly: true,
      justification: ColumnJustification.Right,
      renderCell: (_row, col, column, plan, ariaRowIndex) => (
        <SimpleCell columnIndex={col} tableColumn={column} ariaRowIndex={ariaRowIndex} contentClassName="justify-end">
          <span className="monospaced-s">{plan.desired.length || plan.diffs.length || "-"}</span>
        </SimpleCell>
      ),
    },
    {
      id: "message",
      name: "Details",
      width: -40,
      readonly: true,
      renderCell: (_row, col, column, plan, ariaRowIndex) => {
        const result = results.get(repoKey(plan));
        const text = result
          ? `${result.message}${result.pullRequestId ? ` (!${result.pullRequestId})` : ""}`
          : plan.message;
        return (
          <SimpleCell columnIndex={col} tableColumn={column} ariaRowIndex={ariaRowIndex}>
            <EllipsisCell>{text}</EllipsisCell>
          </SimpleCell>
        );
      },
    },
    {
      id: "expand",
      name: "",
      ariaLabel: "Toggle details",
      width: 70,
      renderCell: (_row, col, column, plan, ariaRowIndex) => {
        if (!interactive || (plan.opResults.length === 0 && plan.diffs.length === 0 && plan.warnings.length === 0)) {
          return <SimpleCell columnIndex={col} tableColumn={column} ariaRowIndex={ariaRowIndex} />;
        }
        const isOpen = expanded.has(repoKey(plan));
        return (
          <SimpleCell columnIndex={col} tableColumn={column} ariaRowIndex={ariaRowIndex}>
            <Button
              subtle
              text={isOpen ? "Hide" : "Show"}
              ariaLabel={`${isOpen ? "Hide" : "Show"} details for ${plan.target.repositoryName}`}
              onClick={() => onToggleExpand(repoKey(plan))}
            />
          </SimpleCell>
        );
      },
    },
  ];

  return (
    <TableBase
      className="rhythm-vertical-8"
      columns={columns}
      itemProvider={new ArrayItemProvider(sorted)}
      role="table"
      ariaLabel="Bulk change preview"
      showLines
    />
  );
}

/**
 * Per-repository details shown in a dialog. Opening it below the table would push the rest of the
 * preview out of view, so the details live in a modal instead.
 */
export function PlanDetailsDialog({ plan, onDismiss }: { plan: RepoPlan; onDismiss: () => void }) {
  return (
    <DialogBase
      titleProps={{ text: `${plan.target.projectName} / ${plan.target.repositoryName}` }}
      onDismiss={onDismiss}
      footerButtonProps={[{ text: "Close", primary: true, onClick: onDismiss }]}
      contentSize={ContentSize.Auto}
    >
      <div className="bc-dialog-body bc-plan-details">
        {plan.opResults.length > 0 ? <OpResultList opResults={plan.opResults} /> : null}
        {plan.warnings.length > 0 ? (
          <ul className="bc-issue-list" aria-label="Warnings">
            {plan.warnings.map((warning, index) => (
              <li key={index} className="bc-op-warning">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {plan.diffs.map((diff, index) => (
          <DiffView key={`${diff.path}-${index}`} diff={diff} />
        ))}
        {plan.opResults.length === 0 && plan.diffs.length === 0 && plan.warnings.length === 0 ? (
          <div className="bc-muted">{plan.message}</div>
        ) : null}
      </div>
    </DialogBase>
  );
}

function OpResultList({ opResults }: { opResults: OpResult[] }) {
  return (
    <ul className="bc-op-results" aria-label="Operation results">
      {opResults.map((result) => (
        <li key={result.index} className="bc-op-result">
          <span className="bc-op-kind">{result.kind}</span>
          <span className="bc-op-path text-ellipsis monospaced-s">{result.path}</span>
          <span
            className={
              result.severity === "error" ? "bc-op-error" : result.severity === "warning" ? "bc-op-warning" : "bc-muted"
            }
          >
            {result.severity === "applied" ? "would apply" : result.severity === "noop" ? "no effect" : result.severity}
            : {result.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
