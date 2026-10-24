import React from "react";
import { Pill } from "azure-devops-ui/Components/Pill/Pill";
import { PillVariant } from "azure-devops-ui/Components/Pill/Pill.Props";
import { hexToRgb, IColor } from "azure-devops-ui/Utilities/Color";
import { ApplyStatus, PlanStatus } from "./types";

/**
 * azure-devops-ui components are typed against the React version they declare as a peer dependency
 * (React 16), whose element type does not satisfy this project's React 19 `JSX.Element`.
 * Casting preserves prop checking while letting the element type resolve.
 */
const PillBase = Pill as unknown as React.ComponentType<React.ComponentProps<typeof Pill>>;

interface StatusDescriptor {
  label: string;
  color: IColor;
}

// Azure DevOps palette colors, so chips match the platform's own status styling.
const GREEN = hexToRgb("#60B999");
const RED = hexToRgb("#A42222");
const ORANGE = hexToRgb("#C27B3D");
const GRAY = hexToRgb("#777777");
const BLUE = hexToRgb("#0078D4");

const PLAN_STATUS: Record<PlanStatus, StatusDescriptor> = {
  pending: { label: "Pending", color: GRAY },
  running: { label: "Reading", color: BLUE },
  "would-change": { label: "Would change", color: ORANGE },
  "no-change": { label: "No change", color: GREEN },
  skipped: { label: "Skipped", color: GRAY },
  error: { label: "Error", color: RED },
};

const APPLY_STATUS: Record<ApplyStatus, StatusDescriptor> = {
  pending: { label: "Pending", color: GRAY },
  running: { label: "Applying", color: BLUE },
  committed: { label: "Committed", color: GREEN },
  "pr-created": { label: "PR created", color: GREEN },
  failed: { label: "Failed", color: RED },
  skipped: { label: "Skipped", color: GRAY },
};

/** Compact status chip used in both preview and apply tables. */
export function StatusPill({ status }: { status: PlanStatus | ApplyStatus }) {
  const descriptor: StatusDescriptor =
    status in PLAN_STATUS ? PLAN_STATUS[status as PlanStatus] : APPLY_STATUS[status as ApplyStatus];

  return (
    <PillBase variant={PillVariant.colored} color={descriptor.color} ariaLabel={descriptor.label}>
      {descriptor.label}
    </PillBase>
  );
}

export interface RunSummary {
  total: number;
  wouldChange: number;
  noChange: number;
  errors: number;
  skipped: number;
  committed: number;
  pullRequests: number;
  failed: number;
  applyDone: number;
}

/**
 * Aggregates preview plans and the apply results collected so far into one object so the header,
 * the confirm dialog and the run summary can share a single source of truth.
 */
export function deriveSummary(
  plans: ReadonlyArray<{ status: PlanStatus }>,
  results: ReadonlyArray<{ status: ApplyStatus }> = [],
): RunSummary {
  const summary: RunSummary = {
    total: plans.length,
    wouldChange: 0,
    noChange: 0,
    errors: 0,
    skipped: 0,
    committed: 0,
    pullRequests: 0,
    failed: 0,
    applyDone: 0,
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
    if (result.status === "skipped") {
      continue;
    }
    summary.applyDone += 1;
    if (result.status === "committed") {
      summary.committed += 1;
    } else if (result.status === "pr-created") {
      summary.pullRequests += 1;
    } else if (result.status === "failed") {
      summary.failed += 1;
    }
  }

  return summary;
}
