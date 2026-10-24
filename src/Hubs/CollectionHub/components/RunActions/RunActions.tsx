import React from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { ButtonGroupBase } from "../../../../components/uiCompat";
import { InlineText, TextTone } from "../../../../components/InlineText/InlineText";
import "./RunActions.css";

export interface RunHint {
  tone: TextTone;
  text: string;
}

interface RunActionsProps {
  canPreview: boolean;
  canApply: boolean;
  /** Apply takes over the primary style once a current preview has something to write. */
  applyIsPrimary: boolean;
  busy: boolean;
  canReset: boolean;
  /** Why the next step is unavailable, or what to do next. */
  hint: RunHint | null;
  onPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
}

/** The run controls: preview first, then apply what was previewed. */
export function RunActions({
  canPreview,
  canApply,
  applyIsPrimary,
  busy,
  canReset,
  hint,
  onPreview,
  onApply,
  onCancel,
  onReset,
}: RunActionsProps) {
  return (
    <div className="bc-run-actions">
      <ButtonGroupBase>
        <Button
          text="Run preview"
          primary={!applyIsPrimary}
          onClick={onPreview}
          disabled={!canPreview}
          tooltipProps={{ text: "Dry-run the definition against the selected repositories" }}
        />
        <Button
          text="Apply"
          primary={applyIsPrimary}
          onClick={onApply}
          disabled={!canApply}
          tooltipProps={{ text: "Write the previewed changes" }}
        />
        {busy ? <Button text="Cancel run" onClick={onCancel} /> : null}
        {canReset ? <Button subtle text="Reset" onClick={onReset} /> : null}
      </ButtonGroupBase>
      {hint ? <InlineText tone={hint.tone}>{hint.text}</InlineText> : null}
    </div>
  );
}
