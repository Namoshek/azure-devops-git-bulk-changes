import { parseDocument, YAMLSeq } from "yaml";
import { appendOperation, BLANK_DEFINITION, countOperations } from "../src/features/bulkChanges/definitionOps";
import { parseDefinition } from "../src/features/bulkChanges/schema";

describe("appendOperation", () => {
  it("appends an operation to an existing list", () => {
    const base = "name: Test\noperations:\n  - add:\n      path: /a.txt\n      content: hi\n";
    const next = appendOperation(base, "delete");
    expect(next).not.toBeNull();
    const doc = parseDocument(next as string);
    const seq = doc.get("operations");
    expect(seq instanceof YAMLSeq).toBe(true);
    expect((seq as YAMLSeq).items.length).toBe(2);
    expect(doc.get("name")).toBe("Test");
  });

  it("creates the operations key when missing", () => {
    const next = appendOperation("name: Test\nwrite_mode: direct_commit\n", "rename");
    expect(next).not.toBeNull();
    const doc = parseDocument(next as string);
    const seq = doc.get("operations");
    expect(seq instanceof YAMLSeq).toBe(true);
    expect((seq as YAMLSeq).items.length).toBe(1);
  });

  it("produces a definition that still validates", () => {
    const next = appendOperation(BLANK_DEFINITION, "replace");
    expect(next).not.toBeNull();
    const result = parseDefinition(next as string);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.operations.length).toBe(1);
    }
  });

  it("returns null for a non-mapping document", () => {
    expect(appendOperation("- just\n- a list\n", "add")).toBeNull();
  });

  it("returns null for unparseable YAML", () => {
    expect(appendOperation("name: [unclosed", "add")).toBeNull();
  });
});

describe("countOperations", () => {
  it("counts items in the operations list", () => {
    expect(countOperations("operations:\n  - add: { path: /a }\n  - delete: { path: /b }\n")).toBe(2);
  });

  it("returns 0 when there is no operations list", () => {
    expect(countOperations("name: Test\n")).toBe(0);
  });

  it("returns 0 for invalid YAML", () => {
    expect(countOperations("name: [unclosed")).toBe(0);
  });
});

describe("BLANK_DEFINITION", () => {
  it("is a mapping that becomes valid once an operation is added", () => {
    // Empty on purpose: it is a scaffold, so it needs an operation before it validates.
    expect(parseDefinition(BLANK_DEFINITION).ok).toBe(false);
    const next = appendOperation(BLANK_DEFINITION, "add");
    expect(next).not.toBeNull();
    expect(parseDefinition(next as string).ok).toBe(true);
  });
});
