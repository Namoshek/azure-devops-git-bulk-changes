import React from "react";
import { RunSummary } from "../../../../features/bulkChanges/summary";
import { WriteMode } from "../../../../features/bulkChanges/types";
import { DialogBase } from "../../../../components/uiCompat";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { InlineText } from "../../../../components/InlineText/InlineText";
import { KeyValueList } from "../../../../components/KeyValueList/KeyValueList";

interface ApplyConfirmDialogProps {
  summary: RunSummary;
  writeMode: WriteMode;
  /** Display names of the repositories that will be written. */
  changing: string[];
  /** Repository names whose planning failed; applying them cannot succeed. */
  failing: string[];
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

const MAX_NAMES = 8;

/** Comma-separated names, truncated so a broad selection does not flood the dialog. */
function nameList(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(", ");
  return names.length > MAX_NAMES ? `${shown} and ${names.length - MAX_NAMES} more` : shown;
}

/**
 * Confirmation before writing. It restates the write mode and the exact number of repositories that
 * will be changed, so an accidental broad selection is visible before anything is committed.
 */
export function ApplyConfirmDialog({
  summary,
  writeMode,
  changing,
  failing,
  busy,
  onConfirm,
  onDismiss,
}: ApplyConfirmDialogProps) {
  const isPullRequest = writeMode === "pullRequest";

  return (
    <DialogBase
      titleProps={{ text: isPullRequest ? "Create pull requests?" : "Commit directly?" }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", onClick: onDismiss, disabled: busy },
        {
          text: isPullRequest ? "Create pull requests" : "Commit",
          primary: true,
          onClick: onConfirm,
          disabled: busy,
        },
      ]}
    >
      <DialogBody>
        <div>
          {isPullRequest
            ? "Each repository gets a new branch and an open pull request. Nothing is merged automatically."
            : "Each repository is committed directly to its target branch. This cannot be undone from this page."}
        </div>
        <KeyValueList
          items={[
            { label: "Repositories to change", value: summary.wouldChange },
            { label: "Already satisfied", value: summary.noChange },
            { label: "Skipped by planning", value: summary.skipped },
            { label: "Planning errors", value: summary.errors },
          ]}
        />
        {changing.length > 0 ? (
          <InlineText tone="muted" monospace>
            {nameList(changing)}
          </InlineText>
        ) : null}
        {failing.length > 0 ? (
          <InlineText tone="error">
            {failing.length} repository(ies) failed during preview and will not be written: {nameList(failing)}
          </InlineText>
        ) : null}
      </DialogBody>
    </DialogBase>
  );
}
