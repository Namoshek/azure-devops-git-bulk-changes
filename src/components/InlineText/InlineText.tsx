import React from "react";
import "./InlineText.css";

export type TextTone = "muted" | "info" | "error" | "warning";

interface InlineTextProps {
  tone: TextTone;
  /** Use the host's small monospaced style. */
  monospace?: boolean;
  children: React.ReactNode;
}

/** Text coloured by meaning (secondary, error, warning) using the host theme's colours. */
export function InlineText({ tone, monospace = false, children }: InlineTextProps) {
  return (
    <span className={`bc-inline-text bc-inline-text--${tone}${monospace ? " monospaced-s" : ""}`}>{children}</span>
  );
}
