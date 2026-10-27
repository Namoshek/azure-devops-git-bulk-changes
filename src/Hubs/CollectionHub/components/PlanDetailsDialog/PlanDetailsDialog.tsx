import React, { useState } from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { ITableColumn, TableColumnLayout, TableColumnStyle } from "azure-devops-ui/Components/Table/Table.Props";
import { RepoPlan, OpResult, OpSeverity } from "../../../../domain/types";
import { DialogBase, SimpleCell, TableBase } from "../../../../components/uiCompat";
import { TabSize } from "azure-devops-ui/Components/Tabs/Tabs.Props";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { InlineText, TextTone } from "../../../../components/InlineText/InlineText";
import { DiffView } from "../DiffView/DiffView";
import "./PlanDetailsDialog.css";
import { Tab, TabBar } from "azure-devops-ui/Tabs";

const SEVERITY_TONE: Record<OpSeverity, TextTone> = {
  applied: "info",
  noop: "muted",
  warning: "warning",
  error: "error",
};

const SEVERITY_LABEL: Record<OpSeverity, string> = {
  applied: "would apply",
  noop: "no effect",
  warning: "warning",
  error: "error",
};

const OPERATIONS_TAB = "operations";
const CHANGES_TAB = "changes";

// A pattern-fan-out operation can touch hundreds of files, so the diff tab renders a generous leading
// slice instead of stopping at the first dozen; the cap only guards against pathological plans, and the
// tab badge plus the operation row still carry the exact counts when it truncates.
const MAX_DIFFS_SHOWN = 300;

/**
 * Per-repository details shown in a dialog. Opening them below the table would push the rest of the
 * results out of view, so they live in a modal instead. The operations and the file diffs are presented as
 * two tabs so each repository's detail stays compact.
 */
export function PlanDetailsDialog({ plan, onDismiss }: { plan: RepoPlan; onDismiss: () => void }) {
  const [selectedTab, setSelectedTab] = useState(OPERATIONS_TAB);

  const hasChanges = plan.diffs.length > 0;
  const isEmpty = plan.opResults.length === 0 && plan.diffs.length === 0 && plan.warnings.length === 0;

  // Warnings are reported alongside the matching warning-severity operation rows, so only surface the
  // ones the operations table does not already show.
  const warningMessages = plan.opResults.filter((r) => r.severity === "warning").map((r) => r.message);
  const extraWarnings = plan.warnings.filter((warning) => !warningMessages.includes(warning));

  const operationsColumns: ITableColumn<OpResult>[] = [
    {
      id: "kind",
      name: "Operation",
      width: 120,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <span className="font-weight-semibold">{result.kind}</span>
        </SimpleCell>
      ),
    },
    {
      id: "path",
      name: "Path",
      width: 220,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          {result.path ? <EllipsisText className="monospaced-s">{result.path}</EllipsisText> : null}
        </SimpleCell>
      ),
    },
    {
      id: "status",
      name: "Status",
      width: 120,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <InlineText tone={SEVERITY_TONE[result.severity]}>{SEVERITY_LABEL[result.severity]}</InlineText>
        </SimpleCell>
      ),
    },
    {
      id: "detail",
      name: "Detail",
      width: -1,
      readonly: true,
      columnLayout: TableColumnLayout.singleLine,
      columnStyle: TableColumnStyle.Secondary,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <EllipsisText className="monospaced-s">{result.message}</EllipsisText>
        </SimpleCell>
      ),
    },
  ];

  return (
    <DialogBase
      className="bc-plan-details-dialog custom-scrollbar"
      titleProps={{ text: `Change Summary for ${plan.target.projectName} / ${plan.target.repositoryName}` }}
      onDismiss={onDismiss}
      contentSize={ContentSize.Auto}
      showCloseButton
    >
      <DialogBody limitContentHeight>
        <TabBar
          className="bc-plan-tabs"
          ariaLabel="Change summary sections"
          tabSize={TabSize.Compact}
          selectedTabId={selectedTab}
          onSelectedTabChanged={setSelectedTab}
        >
          <Tab id={OPERATIONS_TAB} name="Operations" badgeCount={plan.opResults.length} />
          {hasChanges ? <Tab id={CHANGES_TAB} name="File changes" badgeCount={plan.diffs.length} /> : null}
        </TabBar>

        {selectedTab === OPERATIONS_TAB ? (
          plan.opResults.length > 0 ? (
            <TableBase
              columns={operationsColumns}
              itemProvider={new ArrayItemProvider(plan.opResults)}
              role="table"
              ariaLabel="Operation results"
              showLines
            />
          ) : null
        ) : (
          plan.diffs
            .slice(0, MAX_DIFFS_SHOWN)
            .map((diff, index) => <DiffView key={`${diff.path}-${index}`} diff={diff} />)
        )}

        {selectedTab === CHANGES_TAB && plan.diffs.length > MAX_DIFFS_SHOWN ? (
          <InlineText tone="muted">{`${plan.diffs.length - MAX_DIFFS_SHOWN} more file changes are part of this plan but not rendered.`}</InlineText>
        ) : null}

        {extraWarnings.map((warning, index) => (
          <InlineText key={index} tone="warning">
            {warning}
          </InlineText>
        ))}

        {isEmpty ? <InlineText tone="muted">{plan.message}</InlineText> : null}
      </DialogBody>
    </DialogBase>
  );
}
