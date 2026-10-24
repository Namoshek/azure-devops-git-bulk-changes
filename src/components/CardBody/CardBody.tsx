import React from "react";
import "./CardBody.css";

/** Stacks card content vertically; the card's own content area is a horizontal flex row. */
export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className ? `bc-card-body ${className}` : "bc-card-body"}>{children}</div>;
}
