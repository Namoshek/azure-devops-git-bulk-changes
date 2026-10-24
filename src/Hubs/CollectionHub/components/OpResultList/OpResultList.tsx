import React from "react";
import { OpResult } from "../../../../features/bulkChanges/types";
import { EllipsisText } from "../../../../components/EllipsisText/EllipsisText";
import { InlineText, TextTone } from "../../../../components/InlineText/InlineText";
import "./OpResultList.css";

const SEVERITY_TONE: Record<OpResult["severity"], TextTone> = {
  applied: "muted",
  noop: "muted",
  warning: "warning",
  error: "error",
};

const SEVERITY_LABEL: Record<OpResult["severity"], string> = {
  applied: "would apply",
  noop: "no effect",
  warning: "warning",
  error: "error",
};

/** What each operation of the definition did (or would do) in one repository. */
export function OpResultList({ opResults }: { opResults: OpResult[] }) {
  return (
    <ul className="bc-op-results" aria-label="Operation results">
      {opResults.map((result) => (
        <li key={result.index} className="bc-op-result">
          <span className="bc-op-kind font-weight-semibold">{result.kind}</span>
          <EllipsisText className="bc-op-path monospaced-s">{result.path}</EllipsisText>
          <InlineText tone={SEVERITY_TONE[result.severity]}>
            {SEVERITY_LABEL[result.severity]}: {result.message}
          </InlineText>
        </li>
      ))}
    </ul>
  );
}
