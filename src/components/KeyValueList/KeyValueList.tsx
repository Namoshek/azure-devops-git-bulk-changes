import React from "react";
import "./KeyValueList.css";

export interface KeyValueItem {
  label: string;
  value: React.ReactNode;
}

/** Label/value pairs in two aligned columns. */
export function KeyValueList({ items, ariaLabel }: { items: KeyValueItem[]; ariaLabel?: string }) {
  return (
    <dl className="bc-key-value-list" aria-label={ariaLabel}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="secondary-text">{item.label}</dt>
          <dd className="font-weight-semibold">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
