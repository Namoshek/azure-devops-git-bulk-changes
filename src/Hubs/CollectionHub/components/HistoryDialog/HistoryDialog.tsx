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
import { Button } from "azure-devops-ui/Components/Button/Button";
import { ApplyResult, RepoTarget } from "../../../../domain/types";
import { YamlEditor } from "../YamlEditor/YamlEditor";
import { BulkChangeHistoryRecord, getRecentBulkChangeHistory } from "../../../../services/history";
import { getErrorMessage } from "../../../../utils/errorUtils";
import "./HistoryDialog.css";

interface HistoryDialogProps {
  onDismiss: () => void;
  /** True while a run is in flight or the repositories are still loading. */
  disabled: boolean;
  /** What an import means: the owner decides how to load it and which repositories to select. */
  onImport: (definition: HistoryImport) => void;
}

/** A history entry expressed as the definition text plus the repositories it was applied to. */
export interface HistoryImport {
  yamlText: string;
  repositoryIds: string[];
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

/** Browser URL of the DevOps project, cut out of the repository URL (`.../<project>/_git/<repo>`). */
function projectWebUrl(target: RepoTarget): string | undefined {
  if (!target.webUrl) {
    return undefined;
  }
  const gitIndex = target.webUrl.indexOf("/_git/");
  return gitIndex === -1 ? undefined : `${target.webUrl.slice(0, gitIndex)}/_overview`;
}

/** Short hash shown in the table; the full sha stays reachable through the commit link. */
function shortCommitId(commitId: string): string {
  return commitId.slice(0, 8);
}

function ResultReference({ result }: { result: ApplyResult }) {
  // `link` points at the created pull request, so a pull request's merge commit is linked through the
  // repository's own commit route instead.
  const commitLink: string | undefined = result.commitId
    ? result.pullRequestId === undefined
      ? result.link
      : result.target.webUrl && `${result.target.webUrl}/commit/${result.commitId}`
    : undefined;

  if (result.pullRequestId !== undefined) {
    return (
      <div className="bc-history-reference">
        {result.link ? (
          <a href={result.link} target="_blank" rel="noreferrer">
            Pull request !{result.pullRequestId}
          </a>
        ) : (
          <span>Pull request !{result.pullRequestId}</span>
        )}
        {result.commitId
          ? commitLink
            ? (
              <a href={commitLink} target="_blank" rel="noreferrer">
                Commit {shortCommitId(result.commitId)}
              </a>
            )
            : <code>Commit {shortCommitId(result.commitId)}</code>
          : null}
      </div>
    );
  }

  if (result.commitId) {
    return result.link ? (
      <a href={result.link} target="_blank" rel="noreferrer">
        <code>{shortCommitId(result.commitId)}</code>
      </a>
    ) : (
      <code>{shortCommitId(result.commitId)}</code>
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
      width: -30,
      readonly: true,
      columnLayout: TableColumnLayout.twoLine,
      columnStyle: TableColumnStyle.Primary,
      renderCell: (_row, columnIndex, tableColumn, result, ariaRowIndex) => {
        const target = result.target;
        const repositoryUrl = target.webUrl;
        const projectUrl = projectWebUrl(target);
        return (
          <TwoLineCell
            columnIndex={columnIndex}
            tableColumn={tableColumn}
            ariaRowIndex={ariaRowIndex}
            tableCellClassName="bolt-table-cell-primary"
            line1={
              repositoryUrl ? (
                <a href={repositoryUrl} target="_blank" rel="noreferrer">
                  <EllipsisText>{target.repositoryName}</EllipsisText>
                </a>
              ) : (
                <EllipsisText>{target.repositoryName}</EllipsisText>
              )
            }
            line2={
              <EllipsisText className="secondary-text monospaced-s">
                {projectUrl
                  ? (
                    <a href={projectUrl} target="_blank" rel="noreferrer">
                      {target.projectName}
                    </a>
                  )
                  : target.projectName}
              </EllipsisText>
            }
          />
        );
      },
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
      width: -30,
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
      width: -40,
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

function HistoryEntry({
  record,
  disabled,
  onDismiss,
  onImport,
}: {
  record: BulkChangeHistoryRecord;
  disabled: boolean;
  onDismiss: () => void;
  onImport: (definition: HistoryImport) => void;
}) {
  // The run's repositories, deduplicated and free of placeholder ids: an import hands them to the owner,
  // which decides which of them are still selectable.
  const repositoryIds = useMemo(
    () => [...new Set(record.results.map((result) => result.target.repositoryId))].filter((id) => id !== ""),
    [record],
  );

  return (
    <article className="bc-history-entry">
      <header className="bc-history-entry-header">
        <h3>
          {formatTimestamp(record.timestamp)}{" "}
          <Button
            className="bc-history-import-link"
            subtle
            text="(import this change into the editor)"
            disabled={disabled}
            ariaLabel="Import this change definition and its repositories"
            tooltipProps={{
              text: "Load the change definition into the editor and select the repositories of this run that are still available.",
            }}
            onClick={() => {
              onImport({ yamlText: record.yamlText, repositoryIds });
              onDismiss();
            }}
          />
        </h3>
        <span className="secondary-text">
          {record.results.length} {record.results.length === 1 ? "repository" : "repositories"}
        </span>
      </header>

      <HistoryDefinition yamlText={record.yamlText} />

      <HistoryResultsTable results={record.results} timestamp={record.timestamp} />
    </article>
  );
}

export function HistoryDialog({ onDismiss, disabled, onImport }: HistoryDialogProps) {
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
              <HistoryEntry
                key={record.id || `${record.timestamp}-${index}`}
                record={record}
                disabled={disabled}
                onDismiss={onDismiss}
                onImport={onImport}
              />
            ))}
          </div>
        ) : null}
      </DialogBody>
    </DialogBase>
  );
}
