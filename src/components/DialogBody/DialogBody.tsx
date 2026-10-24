import React from "react";
import "./DialogBody.css";

interface DialogBodyProps {
  children: React.ReactNode;
  limitContentHeight?: boolean;
}

/** Standard vertical rhythm and scrolling for dialog content. */
export function DialogBody({ children, limitContentHeight = false }: DialogBodyProps) {
  const className = limitContentHeight ? "bc-dialog-body bc-dialog-body--limit-content-height" : "bc-dialog-body";
  return <div className={className}>{children}</div>;
}
