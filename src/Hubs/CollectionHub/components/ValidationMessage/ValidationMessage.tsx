import React from "react";
import { Icon } from "azure-devops-ui/Icon";
import { ParseResult } from "../../../../domain/schema";
import { InlineText } from "../../../../components/InlineText/InlineText";
import "./ValidationMessage.css";

/** Tells the user whether the YAML is a valid definition, and lists every problem when it is not. */
export function ValidationMessage({ parsed }: { parsed: ParseResult }) {
  return (
    <div className="bc-validation" aria-label="Definition validation">
      {parsed.ok ? (
        <>
          <Icon className="bc-validation-icon-success" iconName="CheckMark" ariaHidden />
          <span>Valid definition with {parsed.definition.operations.length} operation(s)</span>
        </>
      ) : (
        <>
          <Icon className="bc-validation-icon-error" iconName="Error" ariaHidden />
          <span>{`Invalid definition with ${parsed.operationCount} operation(s):`}</span>
          <InlineText tone="error">{parsed.issues.join(" ")}</InlineText>
        </>
      )}
    </div>
  );
}
