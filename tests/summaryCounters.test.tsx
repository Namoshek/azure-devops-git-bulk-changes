import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SummaryItem } from "../src/domain/summary";
import { SummaryCounters } from "../src/components/SummaryCounters/SummaryCounters";

jest.mock("../src/components/StatusLabel/StatusLabel", () => ({
  StatusLabel: ({ status }: { status: string }) => <span>{status}</span>,
}));

const items: SummaryItem[] = [
  { stage: "preview", status: "would-change", label: "Would change", count: 2 },
  { stage: "preview", status: "no-change", label: "No change", count: 0 },
];

describe("SummaryCounters", () => {
  it("selects a status and clears it when selected again", () => {
    const onStatusFilterChange = jest.fn();
    const { rerender } = render(
      <SummaryCounters
        items={items}
        ariaLabel="Run summary"
        selectedStatus={null}
        onStatusFilterChange={onStatusFilterChange}
      />,
    );
    const statusButton = screen.getByRole("button", { name: /would-change\s*2/ });

    expect(statusButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(statusButton);
    expect(onStatusFilterChange).toHaveBeenLastCalledWith("would-change");

    rerender(
      <SummaryCounters
        items={items}
        ariaLabel="Run summary"
        selectedStatus="would-change"
        onStatusFilterChange={onStatusFilterChange}
      />,
    );
    expect(statusButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(statusButton);
    expect(onStatusFilterChange).toHaveBeenLastCalledWith(null);
  });

  it("disables statuses with no results", () => {
    const onStatusFilterChange = jest.fn();
    render(
      <SummaryCounters
        items={items}
        ariaLabel="Run summary"
        selectedStatus={null}
        onStatusFilterChange={onStatusFilterChange}
      />,
    );
    const statusButton = screen.getByRole("button", { name: /no-change/ });

    expect(statusButton).toBeDisabled();
    fireEvent.click(statusButton);
    expect(onStatusFilterChange).not.toHaveBeenCalled();
  });
});
