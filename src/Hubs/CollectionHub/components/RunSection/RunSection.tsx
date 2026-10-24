import React, { useMemo, useState } from "react";
import { deriveSummary, RunStage } from "../../../../domain/bulkChanges/summary";
import { ApplyResult, BulkChangeDefinition, RepoTarget } from "../../../../domain/bulkChanges/types";
import { BulkRunState, definitionKeyOf, isPreviewCurrent } from "../../hooks/useBulkRun";
import { ApplyConfirmDialog } from "../ApplyConfirmDialog/ApplyConfirmDialog";
import { PlanDetailsDialog } from "../PlanDetailsDialog/PlanDetailsDialog";
import { RunActions, RunHint } from "../RunActions/RunActions";
import { RunCard } from "../RunCard/RunCard";
import "./RunSection.css";

interface RunSectionProps {
  /** `null` while the YAML is not a valid definition. */
  definition: BulkChangeDefinition | null;
  yamlText: string;
  targets: RepoTarget[];
  run: BulkRunState;
}

function displayName(target: RepoTarget): string {
  return `${target.projectName} / ${target.repositoryName}`;
}

/** Runs the definition against the selected repositories: preview, review, then apply. */
export function RunSection({ definition, yamlText, targets, run }: RunSectionProps) {
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const summary = useMemo(() => deriveSummary(run.plans, run.results), [run.plans, run.results]);
  const resultsByRepo = useMemo(
    () => new Map<string, ApplyResult>(run.results.map((result) => [result.target.repositoryId, result])),
    [run.results],
  );

  const previewCurrent = isPreviewCurrent(
    run.stamp,
    definition ? definitionKeyOf(definition) : "",
    targets.map((target) => target.repositoryId),
  );
  const stage: RunStage = run.phase === "applying" || run.phase === "applied" ? "apply" : "preview";
  const canPreview = definition !== null && targets.length > 0 && !run.busy;
  const canApply = run.phase === "previewed" && previewCurrent && summary.wouldChange > 0;

  const startPreview = (): void => {
    if (definition) {
      setDetailsId(null);
      setConfirmOpen(false);
      run.startPreview(definition, targets);
    }
  };

  const startApply = (): void => {
    if (definition) {
      setConfirmOpen(false);
      run.startApply(definition, run.plans, yamlText);
    }
  };

  const reset = (): void => {
    setDetailsId(null);
    run.reset();
  };

  const detailsPlan = run.plans.find((plan) => plan.target.repositoryId === detailsId);
  const changing = run.plans.filter((plan) => plan.status === "would-change").map((plan) => displayName(plan.target));
  const failing = run.plans.filter((plan) => plan.status === "error").map((plan) => displayName(plan.target));
  const hint = runHint({
    definitionValid: definition !== null,
    targetCount: targets.length,
    run,
    previewCurrent,
    wouldChange: summary.wouldChange,
  });

  return (
    <div className="bc-run-section">
      <RunActions
        canPreview={canPreview}
        canApply={canApply && !run.busy}
        applyIsPrimary={canApply}
        busy={run.busy}
        canReset={run.phase === "previewed" || run.phase === "applied"}
        hint={hint}
        onPreview={startPreview}
        onApply={() => setConfirmOpen(true)}
        onCancel={run.cancel}
        onReset={reset}
      />

      <RunCard
        stage={stage}
        plans={run.plans}
        results={resultsByRepo}
        summary={summary}
        busy={run.busy}
        done={run.done}
        total={run.total}
        error={run.error}
        onShowDetails={setDetailsId}
      />

      {detailsPlan ? <PlanDetailsDialog plan={detailsPlan} onDismiss={() => setDetailsId(null)} /> : null}

      {confirmOpen && definition ? (
        <ApplyConfirmDialog
          summary={summary}
          writeMode={definition.writeMode}
          changing={changing}
          failing={failing}
          busy={run.busy}
          onConfirm={startApply}
          onDismiss={() => setConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface HintInput {
  definitionValid: boolean;
  targetCount: number;
  run: BulkRunState;
  previewCurrent: boolean;
  wouldChange: number;
}

/** The single most relevant next step, or the reason the primary action is unavailable. */
function runHint({ definitionValid, targetCount, run, previewCurrent, wouldChange }: HintInput): RunHint | null {
  if (run.busy) {
    return null;
  }
  if (run.phase === "previewed") {
    if (!previewCurrent) {
      return {
        tone: "warning",
        text: "The definition or the selected repositories changed. Run the preview again before applying.",
      };
    }
    return { tone: "muted", text: wouldChange > 0 ? "Review the results, then apply." : "Nothing to apply." };
  }
  if (!definitionValid) {
    return { tone: "muted", text: "Fix the change definition to run a preview." };
  }
  if (targetCount === 0) {
    return { tone: "muted", text: "Select at least one repository to run a preview." };
  }
  return null;
}
