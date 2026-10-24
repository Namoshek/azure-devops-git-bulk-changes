import React from "react";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { RunStage, RunSummary, summaryItems } from "../../../../features/bulkChanges/summary";
import { ApplyResult, RepoPlan } from "../../../../features/bulkChanges/types";
import { InlineText } from "../../../../components/InlineText/InlineText";
import { CardBody } from "../../../../components/CardBody/CardBody";
import { SummaryCounters } from "../../../../components/SummaryCounters/SummaryCounters";
import { CardBase, MessageCardBase, ProgressBarBase } from "../../../../components/uiCompat";
import { ResultsTable } from "../ResultsTable/ResultsTable";
import "./RunCard.css";

interface RunCardProps {
  stage: RunStage;
  plans: RepoPlan[];
  results: Map<string, ApplyResult>;
  summary: RunSummary;
  busy: boolean;
  /** How many of the run's repositories are settled, out of `total`. */
  done: number;
  total: number;
  error: string | null;
  onShowDetails: (repositoryId: string) => void;
}

function progressText(stage: RunStage, done: number, total: number): string {
  return stage === "apply"
    ? `${done} of ${total} repositories written`
    : `Dry run, nothing is written yet. ${done} of ${total} repositories checked.`;
}

/** The outcome of the current run: counters and per-repository results, for preview and apply alike. */
export function RunCard({ stage, plans, results, summary, busy, done, total, error, onShowDetails }: RunCardProps) {
  const hasRun = plans.length > 0 || busy;

  return (
    <CardBase
      titleProps={{ text: stage === "apply" ? "Apply results" : "Preview results", size: TitleSize.Medium }}
      headerDescriptionProps={{ text: hasRun ? progressText(stage, done, total) : undefined }}
      contentProps={{ contentPadding: false }}
      className="bolt-card-white padding-bottom-0"
    >
      <CardBody>
        {error ? (
          <div className="bc-run-card-section">
            <MessageCardBase severity={MessageCardSeverity.Error} role="alert">
              {error}
            </MessageCardBase>
          </div>
        ) : null}

        {hasRun ? (
          <>
            <div className="bc-run-card-section">
              {busy ? (
                <ProgressBarBase currentValue={done} maxValue={Math.max(1, total)} ariaLabel="Run progress" />
              ) : null}
              <SummaryCounters items={summaryItems(summary, stage)} ariaLabel="Run summary" />
            </div>
            {plans.length > 0 ? (
              <ResultsTable plans={plans} results={results} interactive={!busy} onShowDetails={onShowDetails} />
            ) : null}
          </>
        ) : (
          <div className="bc-run-card-section">
            <InlineText tone="muted">
              Select repositories, then run a preview. Nothing is written until you apply, and applying re-reads the
              branch tip so a stale preview can never overwrite newer commits.
            </InlineText>
          </div>
        )}
      </CardBody>
    </CardBase>
  );
}
