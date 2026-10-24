import React from "react";
import { SummaryItem } from "../../features/bulkChanges/summary";
import { StatusLabel } from "../StatusLabel/StatusLabel";
import "./SummaryCounters.css";

/** A row of per-status counters; each uses the same status icon and label as the table rows it counts. */
export function SummaryCounters({ items, ariaLabel }: { items: SummaryItem[]; ariaLabel: string }) {
  return (
    <ul className="bc-summary-counters" aria-label={ariaLabel}>
      {items.map((item) => (
        <li
          key={item.status}
          className={item.count === 0 ? "bc-summary-counter bc-summary-counter--zero" : "bc-summary-counter"}
        >
          <StatusLabel stage={item.stage} status={item.status} />
          <span className="font-weight-semibold">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}
