import React from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { DialogBase } from "../../../../components/uiCompat";
import "./HelpDialog.css";

export const GITHUB_URL = "https://github.com/Namoshek/azure-devops-git-bulk-changes";

export function HelpDialog({ onDismiss }: { onDismiss: () => void }) {
  return (
    <DialogBase
      titleProps={{ text: "How this extension works", size: TitleSize.Large }}
      showCloseButton
      onDismiss={onDismiss}
      contentSize={ContentSize.ExtraLarge}
    >
      <DialogBody>
        <div>
          <h3>What this extension offers</h3>
          <p>
            Apply the same Git change to multiple repositories you can access across the organization. Define ordered
            file operations once in YAML, then choose to create pull requests or commit directly to target branches.
          </p>

          <h3>How it works</h3>
          <ol className="bc-help-steps">
            <li>
              <strong>Configure the target repositories and change operations.</strong> Select the repositories to
              include, then edit the YAML definition to choose the write mode and specify the ordered file operations.
              Examples are available as starting points.
            </li>
            <li>
              <strong>Review the preview.</strong> The preview is a read-only dry run. Check each repository&apos;s
              status, exact diff, and any skipped operations or errors before proceeding.
            </li>
            <li>
              <strong>Confirm applying the changes.</strong> Review the confirmation and apply. Pull-request mode
              creates a branch and opens a pull request for each repository; direct-commit mode writes to the target
              branch and cannot be undone from this page. The branch tip is checked again before writing, and
              repositories are processed independently.
            </li>
          </ol>
          <p>
            See the{" "}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub project
            </a>{" "}
            for the full guide, supported YAML operations, and limitations.
          </p>
        </div>
      </DialogBody>
    </DialogBase>
  );
}
