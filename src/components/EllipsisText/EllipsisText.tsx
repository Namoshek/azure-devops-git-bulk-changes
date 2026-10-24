import React from "react";
import { TooltipBase } from "../uiCompat";

/** Truncates its content with an ellipsis and shows the full text in a tooltip only when it is clipped. */
export function EllipsisText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TooltipBase overflowOnly showOnFocus>
      <div className={className ? `text-ellipsis ${className}` : "text-ellipsis"}>{children}</div>
    </TooltipBase>
  );
}
