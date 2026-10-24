import React from "react";
import "./DialogBody.css";

/** Standard vertical rhythm and scrolling for dialog content. */
export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="bc-dialog-body">{children}</div>;
}
