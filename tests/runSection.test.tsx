import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { BulkRunState } from "../src/Hubs/CollectionHub/hooks/useBulkRun";
import { RunSection } from "../src/Hubs/CollectionHub/components/RunSection/RunSection";

jest.mock("../src/Hubs/CollectionHub/hooks/useBulkRun", () => ({
  definitionKeyOf: () => "",
  isPreviewCurrent: () => false,
}));

jest.mock("../src/Hubs/CollectionHub/components/RunCard/RunCard", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    RunCard: ({
      statusFilter,
      onStatusFilterChange,
    }: {
      statusFilter: string | null;
      onStatusFilterChange: (status: string | null) => void;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => onStatusFilterChange(statusFilter === null ? "would-change" : null),
        },
        "Toggle filter",
      ),
  };
});

jest.mock("../src/Hubs/CollectionHub/components/RunActions/RunActions", () => ({
  RunActions: () => null,
}));

jest.mock("../src/Hubs/CollectionHub/components/ApplyConfirmDialog/ApplyConfirmDialog", () => ({
  ApplyConfirmDialog: () => null,
}));

jest.mock("../src/Hubs/CollectionHub/components/PlanDetailsDialog/PlanDetailsDialog", () => ({
  PlanDetailsDialog: () => null,
}));

describe("RunSection", () => {
  it("restores page scroll position after changing status filter", () => {
    const scrollTo = jest.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });

    const run: BulkRunState = {
      phase: "idle",
      plans: [],
      results: [],
      error: null,
      busy: false,
      done: 0,
      total: 0,
      stamp: null,
      startPreview: jest.fn(),
      startApply: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
    };

    render(<RunSection definition={null} yamlText="" targets={[]} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle filter" }));

    expect(scrollTo).toHaveBeenCalledWith(12, 240);
  });
});
