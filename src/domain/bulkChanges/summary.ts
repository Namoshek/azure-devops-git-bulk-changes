import { ApplyStatus, PlanStatus } from "./types";

/** Which phase of a run a status belongs to; "running" and "skipped" mean different things in each. */
export type RunStage = "preview" | "apply";

export interface RunSummary {
  wouldChange: number;
  noChange: number;
  errors: number;
  /** Repositories skipped while planning. */
  skipped: number;
  committed: number;
  pullRequests: number;
  failed: number;
  /** Repositories not written because there was nothing to apply, or the run was cancelled. */
  applySkipped: number;
}

const PREVIEW_LABELS: Record<PlanStatus, string> = {
  pending: "Pending",
  running: "Reading",
  "would-change": "Would change",
  "no-change": "No change",
  skipped: "Skipped",
  error: "Error",
};

const APPLY_LABELS: Record<ApplyStatus, string> = {
  pending: "Pending",
  running: "Applying",
  committed: "Committed",
  "pr-created": "PR created",
  failed: "Failed",
  skipped: "Skipped",
};

/** Display text for a repository status, shared by the results table and the summary counters. */
export function statusLabel(stage: RunStage, status: PlanStatus | ApplyStatus): string {
  const labels: Record<string, string> = stage === "preview" ? PREVIEW_LABELS : APPLY_LABELS;
  return labels[status] ?? status;
}

/**
 * Aggregates preview plans and the apply results collected so far into one object so the run card
 * and the confirm dialog share a single source of truth.
 */
export function deriveSummary(
  plans: ReadonlyArray<{ status: PlanStatus }>,
  results: ReadonlyArray<{ status: ApplyStatus }> = [],
): RunSummary {
  const summary: RunSummary = {
    wouldChange: 0,
    noChange: 0,
    errors: 0,
    skipped: 0,
    committed: 0,
    pullRequests: 0,
    failed: 0,
    applySkipped: 0,
  };

  for (const plan of plans) {
    if (plan.status === "would-change") {
      summary.wouldChange += 1;
    } else if (plan.status === "no-change") {
      summary.noChange += 1;
    } else if (plan.status === "error") {
      summary.errors += 1;
    } else if (plan.status === "skipped") {
      summary.skipped += 1;
    }
  }

  for (const result of results) {
    if (result.status === "committed") {
      summary.committed += 1;
    } else if (result.status === "pr-created") {
      summary.pullRequests += 1;
    } else if (result.status === "failed") {
      summary.failed += 1;
    } else if (result.status === "skipped") {
      summary.applySkipped += 1;
    }
  }

  return summary;
}

export interface SummaryItem {
  stage: RunStage;
  status: PlanStatus | ApplyStatus;
  label: string;
  count: number;
}

/**
 * The counters shown above the results table. They use the same stage and status labels as the table
 * rows, so a count can always be matched to the rows it describes.
 */
export function summaryItems(summary: RunSummary, stage: RunStage): SummaryItem[] {
  const item = (status: PlanStatus | ApplyStatus, count: number): SummaryItem => ({
    stage,
    status,
    label: statusLabel(stage, status),
    count,
  });

  if (stage === "apply") {
    return [
      item("committed", summary.committed),
      item("pr-created", summary.pullRequests),
      item("failed", summary.failed),
      item("skipped", summary.applySkipped),
    ];
  }
  return [
    item("would-change", summary.wouldChange),
    item("no-change", summary.noChange),
    item("error", summary.errors),
    item("skipped", summary.skipped),
  ];
}
