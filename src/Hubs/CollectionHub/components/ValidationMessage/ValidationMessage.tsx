import React from "react";
import { ParseResult } from "../../../../domain/bulkChanges/schema";
import { InlineText } from "../../../../components/InlineText/InlineText";
import "./ValidationMessage.css";

/** Tells the user whether the YAML is a valid definition, and lists every problem when it is not. */
export function ValidationMessage({ parsed }: { parsed: ParseResult }) {
  if (parsed.ok) {
    return (
      <div className="bc-validation">
        <InlineText tone="muted">Valid definition with {parsed.definition.operations.length} operation(s).</InlineText>
      </div>
    );
  }

  return (
    <ul className="bc-validation bc-validation-issues" aria-label="Definition problems">
      {parsed.issues.map((issue, index) => (
        <li key={index}>
          <InlineText tone="error">{issue}</InlineText>
        </li>
      ))}
    </ul>
  );
}
