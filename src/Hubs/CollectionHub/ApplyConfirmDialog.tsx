import React from "react";
import { Dialog } from "azure-devops-ui/Components/Dialog/Dialog";
import { RepoPlan, WriteMode } from "../../features/bulkChanges/types";
import { deriveSummary } from "../../features/bulkChanges/statusUi";
import { asComponent } from "../../components/uiCompat";

const DialogBase = asComponent(Dialog);

interface ApplyConfirmDialogProps {
  plans: RepoPlan[];
  writeMode: WriteMode;
  /** Repository names whose planning failed; applying them cannot succeed. */
  failing: string[];
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * Confirmation before writing. It restates the write mode and the exact number of repositories that
 * will be changed, so an accidental broad selection is visible before anything is committed.
 */
export function ApplyConfirmDialog({ plans, writeMode, failing, busy, onConfirm, onDismiss }: ApplyConfirmDialogProps) {
  const summary = deriveSummary(plans);
  const targets = plans.filter((plan) => plan.status === "would-change");

  return (
    <DialogBase
      titleProps={{ text: writeMode === "pullRequest" ? "Create pull requests?" : "Commit directly?" }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", onClick: onDismiss, disabled: busy },
        {
          text: writeMode === "pullRequest" ? "Create pull requests" : "Commit",
          primary: true,
          onClick: onConfirm,
          disabled: busy,
        },
      ]}
    >
      <div className="bc-dialog-body">
        <div>
          {writeMode === "pullRequest"
            ? "Each repository gets a new branch and an open pull request. Nothing is merged automatically."
            : "Each repository is committed directly to its target branch. This cannot be undone from this page."}
        </div>
        <div className="bc-summary-grid">
          <span>Repositories to change</span>
          <span className="bc-summary-value">{summary.wouldChange}</span>
          <span>Already satisfied</span>
          <span>{summary.noChange}</span>
          <span>Skipped by planning</span>
          <span>{summary.skipped}</span>
          <span>Planning errors</span>
          <span className={summary.errors > 0 ? "bc-op-error" : undefined}>{summary.errors}</span>
        </div>
        {failing.length > 0 ? (
          <div className="bc-op-error">
            {failing.length} repository(ies) failed during preview and will not be written:{" "}
            {failing.slice(0, 8).join(", ")}
            {failing.length > 8 ? ` and ${failing.length - 8} more` : ""}
          </div>
        ) : null}
        <div className="bc-muted monospaced-s">
          {targets
            .slice(0, 12)
            .map((plan) => `${plan.target.projectName}/${plan.target.repositoryName} (${plan.desired.length} file(s))`)
            .join(", ")}
          {targets.length > 12 ? ` and ${targets.length - 12} more` : ""}
        </div>
      </div>
    </DialogBase>
  );
}
