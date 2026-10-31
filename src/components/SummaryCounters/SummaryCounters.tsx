import React from "react";
import { SummaryItem } from "../../domain/summary";
import { StatusLabel } from "../StatusLabel/StatusLabel";
import "./SummaryCounters.css";

interface SummaryCountersProps {
  items: SummaryItem[];
  ariaLabel: string;
  selectedStatus: SummaryItem["status"] | null;
  onStatusFilterChange: (status: SummaryItem["status"] | null) => void;
}

/** A row of per-status filters; each uses the same status icon and label as the table rows it counts. */
export function SummaryCounters({
  items,
  ariaLabel,
  selectedStatus,
  onStatusFilterChange,
}: SummaryCountersProps) {
  return (
    <ul className="bc-summary-counters" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.status}>
          <button
            type="button"
            className={`bc-summary-counter${selectedStatus === item.status ? " bc-summary-counter--selected" : ""}`}
            aria-pressed={selectedStatus === item.status}
            disabled={item.count === 0}
            onClick={() => onStatusFilterChange(selectedStatus === item.status ? null : item.status)}
          >
            <StatusLabel stage={item.stage} status={item.status} />
            <span className="font-weight-semibold">{item.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
