import React, { useEffect, useMemo, useState } from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { Spinner } from "azure-devops-ui/Components/Spinner/Spinner";
import { SpinnerSize } from "azure-devops-ui/Components/Spinner/Spinner.Props";
import { ITableColumn, TableColumnLayout, TableColumnStyle } from "azure-devops-ui/Components/Table/Table.Props";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { MessageCardBase, DialogBase } from "../../../../components/uiCompat";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { StatusLabel } from "../../../../components/StatusLabel/StatusLabel";
import { SimpleCell, TableBase, TwoLineCell } from "../../../../components/uiCompat";
import { ApplyResult } from "../../../../domain/types";
import { YamlEditor } from "../YamlEditor/YamlEditor";
import { BulkChangeHistoryRecord, getRecentBulkChangeHistory } from "../../../../services/history";
import { getErrorMessage } from "../../../../utils/errorUtils";
import "./HistoryDialog.css";

interface HistoryDialogProps {
  onDismiss: () => void;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function ResultReference({ result }: { result: ApplyResult }) {
  if (result.pullRequestId !== undefined) {
    return result.link ? (
      <div className="bc-history-reference">
        <a href={result.link} target="_blank" rel="noreferrer">
          Pull request !{result.pullRequestId}
        </a>
        {result.commitId ? <code>Commit {result.commitId}</code> : null}
      </div>
    ) : (
      <div className="bc-history-reference">
        <span>Pull request !{result.pullRequestId}</span>
        {result.commitId ? <code>Commit {result.commitId}</code> : null}
      </div>
    );
  }

  if (result.commitId) {
    return result.link ? (
      <a href={result.link} target="_blank" rel="noreferrer">
        <code>{result.commitId}</code>
      </a>
    ) : (
      <code>{result.commitId}</code>
    );
  }

  return <span className="secondary-text">-</span>;
}

function HistoryResultsTable({ results, timestamp }: { results: ApplyResult[]; timestamp: string }) {
  const itemProvider = useMemo(() => new ArrayItemProvider(results), [results]);
  const columns: ITableColumn<ApplyResult>[] = [
    {
      id: "repository",
      name: "Repository",
      width: -28,
      readonly: true,
      columnLayout: TableColumnLayout.twoLine,
      columnStyle: TableColumnStyle.Primary,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <TwoLineCell
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          ariaRowIndex={ariaRowIndex}
          tableCellClassName="bolt-table-cell-primary"
          line1={
            result.target.webUrl ? (
              <a href={result.target.webUrl} target="_blank" rel="noreferrer">
                <EllipsisText>{result.target.repositoryName}</EllipsisText>
              </a>
            ) : (
              <EllipsisText>{result.target.repositoryName}</EllipsisText>
            )
          }
          line2={
            <EllipsisText className="secondary-text monospaced-s">
              {result.target.projectName} · {result.target.projectId}
            </EllipsisText>
          }
        />
      ),
    },
    {
      id: "status",
      name: "Status",
      width: 140,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <StatusLabel stage="apply" status={result.status} />
        </SimpleCell>
      ),
    },
    {
      id: "reference",
      name: "Commit / pull request",
      width: -28,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <ResultReference result={result} />
        </SimpleCell>
      ),
    },
    {
      id: "result",
      name: "Result",
      width: -44,
      readonly: true,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => (
        <SimpleCell columnIndex={columnIndex} tableColumn={tableColumn} ariaRowIndex={ariaRowIndex}>
          <EllipsisText className="monospaced-s">{result.message}</EllipsisText>
        </SimpleCell>
      ),
    },
  ];

  return (
    <div className="bc-history-table-scroll">
      <TableBase
        columns={columns}
        itemProvider={itemProvider}
        role="table"
        ariaLabel={`Repositories applied at ${formatTimestamp(timestamp)}`}
        showLines
      />
    </div>
  );
}

function HistoryDefinition({ yamlText }: { yamlText: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="bc-history-definition"
      onToggle={(event: React.SyntheticEvent<HTMLDetailsElement>) => setOpen(event.currentTarget.open)}
    >
      <summary>Applied change definition (YAML)</summary>
      {open ? (
        <div className="bc-history-editor">
          <YamlEditor
            value={yamlText}
            ariaLabel="Applied change definition YAML"
            disabled
            automaticLayout={false}
            onChange={() => {}}
          />
        </div>
      ) : null}
    </details>
  );
}

function HistoryEntry({ record }: { record: BulkChangeHistoryRecord }) {
  return (
    <article className="bc-history-entry">
      <header className="bc-history-entry-header">
        <h3>{formatTimestamp(record.timestamp)}</h3>
        <span className="secondary-text">
          {record.results.length} {record.results.length === 1 ? "repository" : "repositories"}
        </span>
      </header>

      <HistoryDefinition yamlText={record.yamlText} />

      <HistoryResultsTable results={record.results} timestamp={record.timestamp} />
    </article>
  );
}

export function HistoryDialog({ onDismiss }: HistoryDialogProps) {
  const [records, setRecords] = useState<BulkChangeHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getRecentBulkChangeHistory()
      .then((recent) => {
        if (mounted) {
          setRecords(recent);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(`Failed to load bulk change history: ${getErrorMessage(err)}`);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <DialogBase
      titleProps={{ text: "Bulk Change History", size: TitleSize.Large }}
      showCloseButton
      onDismiss={onDismiss}
      contentSize={ContentSize.Auto}
      className="custom-scrollbar"
    >
      <DialogBody className="padding-right-4">
        {loading ? (
          <div className="bc-history-loading">
            <Spinner size={SpinnerSize.large} label="Loading history..." />
          </div>
        ) : null}
        {!loading && error ? <MessageCardBase severity={MessageCardSeverity.Error}>{error}</MessageCardBase> : null}
        {!loading && !error && records.length === 0 ? (
          <p className="secondary-text bc-history-empty">No bulk changes have been recorded yet.</p>
        ) : null}
        {!loading && !error && records.length > 0 ? (
          <div className="bc-history-list">
            {records.map((record, index) => (
              <HistoryEntry key={record.id || `${record.timestamp}-${index}`} record={record} />
            ))}
          </div>
        ) : null}
      </DialogBody>
    </DialogBase>
  );
}
