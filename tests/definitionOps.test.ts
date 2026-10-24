import { parseDocument, YAMLSeq } from "yaml";
import { appendOperation, BLANK_DEFINITION, countOperations } from "../src/domain/definitionOps";
import { parseDefinition } from "../src/domain/schema";

describe("appendOperation", () => {
  it("appends an operation to an existing list", () => {
    const base = "writeMode: directCommit\noperations:\n  - add:\n      path: /a.txt\n      content: hi\n";
    const next = appendOperation(base, "delete");
    expect(next).not.toBeNull();
    const doc = parseDocument(next as string);
    const seq = doc.get("operations");
    expect(seq instanceof YAMLSeq).toBe(true);
    expect((seq as YAMLSeq).items.length).toBe(2);
    expect(doc.get("writeMode")).toBe("directCommit");
  });

  it("creates the operations key when missing", () => {
    const next = appendOperation("writeMode: directCommit\n", "rename");
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

  it.each(["add", "addContent", "applyPatch", "delete", "rename", "replace"] as const)(
    "appends a %s operation that validates",
    (kind) => {
      const next = appendOperation(BLANK_DEFINITION, kind);
      expect(next).not.toBeNull();
      const result = parseDefinition(next as string);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.definition.operations[0].kind).toBe(kind);
      }
    },
  );

  it("lists the allowed values of enum fields in a comment on the same line", () => {
    const addContent = appendOperation(BLANK_DEFINITION, "addContent") as string;
    expect(addContent).toMatch(/^\s+position: end # start \| end \| lineNumber$/m);
    expect(addContent).toMatch(/^\s+lineNumber: 1 # 1-based; only used when position is lineNumber$/m);
    expect(addContent).toMatch(/^\s+onFileMissing: skip # error \| skip \| createIfMissing$/m);

    const applyPatch = appendOperation(BLANK_DEFINITION, "applyPatch") as string;
    expect(applyPatch).toContain(
      "# apply a Git patch; create with 'git show --format= --no-ext-diff --no-color --find-renames <commit>'",
    );
    expect(applyPatch).toContain("text Git unified diff; binary and file-mode-only patches are unsupported");

    expect(appendOperation(BLANK_DEFINITION, "delete") as string).toMatch(/^\s+onFileMissing: skip # error \| skip$/m);
    expect(appendOperation(BLANK_DEFINITION, "rename") as string).toMatch(/^\s+onFileMissing: skip # error \| skip$/m);
    expect(appendOperation(BLANK_DEFINITION, "replace") as string).toMatch(
      /^\s+onNoMatch: skip # error \| skip \| createIfMissing$/m,
    );
  });

  it("documents the write mode in the blank definition", () => {
    expect(BLANK_DEFINITION).toContain("writeMode: pullRequest # directCommit | pullRequest");
    expect(BLANK_DEFINITION).toContain("autoMerge: false");
  });
});

describe("countOperations", () => {
  it("counts items in the operations list", () => {
    expect(countOperations("operations:\n  - add: { path: /a }\n  - delete: { path: /b }\n")).toBe(2);
  });

  it("returns 0 when there is no operations list", () => {
    expect(countOperations("writeMode: directCommit\n")).toBe(0);
  });

  it("returns 0 for invalid YAML", () => {
    expect(countOperations("writeMode: [unclosed")).toBe(0);
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
