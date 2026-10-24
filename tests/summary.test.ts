import { deriveSummary, statusLabel, summaryItems } from "../src/domain/summary";

describe("deriveSummary", () => {
  it("counts plan and apply statuses separately", () => {
    const summary = deriveSummary(
      [{ status: "would-change" }, { status: "would-change" }, { status: "no-change" }, { status: "error" }],
      [{ status: "committed" }, { status: "pr-created" }, { status: "failed" }, { status: "skipped" }],
    );

    expect(summary).toEqual({
      wouldChange: 2,
      noChange: 1,
      errors: 1,
      skipped: 0,
      committed: 1,
      pullRequests: 1,
      failed: 1,
      applySkipped: 1,
    });
  });
});

describe("statusLabel", () => {
  it("distinguishes the same status between stages", () => {
    expect(statusLabel("preview", "running")).toBe("Reading");
    expect(statusLabel("apply", "running")).toBe("Applying");
  });
});

describe("summaryItems", () => {
  const summary = deriveSummary([{ status: "would-change" }], [{ status: "committed" }]);

  it("lists preview outcomes", () => {
    expect(summaryItems(summary, "preview").map((item) => [item.label, item.count])).toEqual([
      ["Would change", 1],
      ["No change", 0],
      ["Error", 0],
      ["Skipped", 0],
    ]);
  });

  it("lists apply outcomes", () => {
    expect(summaryItems(summary, "apply").map((item) => [item.label, item.count])).toEqual([
      ["Committed", 1],
      ["PR created", 0],
      ["Failed", 0],
      ["Skipped", 0],
    ]);
  });
});
