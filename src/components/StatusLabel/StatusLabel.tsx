import React from "react";
import { StatusSize } from "azure-devops-ui/Components/Status/Status.Props";
import { Statuses, StatusType } from "azure-devops-ui/Components/Status/Status";
import { RunStage, statusLabel } from "../../domain/bulkChanges/summary";
import { ApplyStatus, PlanStatus } from "../../domain/bulkChanges/types";
import { StatusBase, TooltipBase } from "../uiCompat";
import "./StatusLabel.css";

interface StatusDescriptor {
  icon: StatusType;
  /** Shown as a tooltip so the label's exact meaning is one hover away. */
  description: string;
}

const PREVIEW: Record<PlanStatus, StatusDescriptor> = {
  pending: { icon: "Waiting", description: "Waiting to be read." },
  running: { icon: "Running", description: "Reading the repository and planning the change." },
  "would-change": { icon: "Information", description: "Applying the definition would change this repository." },
  "no-change": { icon: "Success", description: "The repository already matches the definition; nothing to write." },
  skipped: { icon: "Skipped", description: "Not planned, for example because the run was cancelled." },
  error: { icon: "Failed", description: "Planning failed; this repository will not be written." },
};

const APPLY: Record<ApplyStatus, StatusDescriptor> = {
  pending: { icon: "Waiting", description: "Waiting to be written." },
  running: { icon: "Running", description: "Writing the change." },
  committed: { icon: "Success", description: "The change was committed to the target branch." },
  "pr-created": { icon: "Success", description: "A pull request with the change was created." },
  failed: { icon: "Failed", description: "Writing the change failed." },
  skipped: { icon: "Skipped", description: "Nothing was written for this repository." },
};

interface StatusLabelProps {
  stage: RunStage;
  status: PlanStatus | ApplyStatus;
}

/** A repository status as a standard Azure DevOps status icon followed by plain text. */
export function StatusLabel({ stage, status }: StatusLabelProps) {
  const descriptors: Record<string, StatusDescriptor> = stage === "preview" ? PREVIEW : APPLY;
  const descriptor = descriptors[status];
  const label = statusLabel(stage, status);

  return (
    <TooltipBase text={descriptor?.description}>
      <span className="bc-status-label">
        <StatusBase {...Statuses[descriptor?.icon ?? "Waiting"]} size={StatusSize.m} />
        <span>{label}</span>
      </span>
    </TooltipBase>
  );
}
