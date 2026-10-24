import React from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { RepoPlan } from "../../../../domain/bulkChanges/types";
import { DialogBase } from "../../../../components/uiCompat";
import { DialogBody } from "../../../../components/DialogBody/DialogBody";
import { InlineText } from "../../../../components/InlineText/InlineText";
import { DiffView } from "../DiffView/DiffView";
import { OpResultList } from "../OpResultList/OpResultList";

/**
 * Per-repository details shown in a dialog. Opening them below the table would push the rest of the
 * results out of view, so they live in a modal instead.
 */
export function PlanDetailsDialog({ plan, onDismiss }: { plan: RepoPlan; onDismiss: () => void }) {
  const isEmpty = plan.opResults.length === 0 && plan.diffs.length === 0 && plan.warnings.length === 0;

  return (
    <DialogBase
      titleProps={{ text: `${plan.target.projectName} / ${plan.target.repositoryName}` }}
      onDismiss={onDismiss}
      footerButtonProps={[{ text: "Close", primary: true, onClick: onDismiss }]}
      contentSize={ContentSize.Auto}
    >
      <DialogBody limitContentHeight>
        {plan.opResults.length > 0 ? <OpResultList opResults={plan.opResults} /> : null}
        {plan.warnings.map((warning, index) => (
          <InlineText key={index} tone="warning">
            {warning}
          </InlineText>
        ))}
        {plan.diffs.map((diff, index) => (
          <DiffView key={`${diff.path}-${index}`} diff={diff} />
        ))}
        {isEmpty ? <InlineText tone="muted">{plan.message}</InlineText> : null}
      </DialogBody>
    </DialogBase>
  );
}
