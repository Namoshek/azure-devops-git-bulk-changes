import { parseDefinition } from "../src/domain/schema";

function valid(definition: string) {
  const result = parseDefinition(definition);
  if (!result.ok) {
    throw new Error(`Expected valid definition, got issues: ${result.issues.join("; ")}`);
  }
  return result.definition;
}

describe("parseDefinition", () => {
  it("accepts a minimal add definition and applies defaults", () => {
    const definition = valid(`
  operations:
  - add:
      path: /LICENSE
      content: "hello"
`);

    expect(definition.operations).toHaveLength(1);
    expect(definition.operations[0]).toEqual({ kind: "add", path: "/LICENSE", content: "hello", onlyIfMissing: false });
    expect(definition.writeMode).toBe("directCommit");
    expect(definition.branch).toBeNull();
    expect(definition.commitMessage).toBe("Apply bulk changes");
    expect(definition.pullRequest).toEqual({
      branchName: "bulk-changes",
      title: "Apply bulk changes",
      description: "",
      draft: false,
      autoMerge: false,
    });
  });

  it("maps pullRequest write mode and pull request settings", () => {
    const definition = valid(`
writeMode: pullRequest
commitMessage: "Add LICENSE"
pullRequest:
  branchName: bulk/add-license
  title: "Add LICENSE"
  description: "body"
  draft: false
  autoMerge: true
operations:
  - add:
      path: /LICENSE
      content: "x"
`);
    expect(definition.writeMode).toBe("pullRequest");
    expect(definition.pullRequest).toEqual({
      branchName: "bulk/add-license",
      title: "Add LICENSE",
      description: "body",
      draft: false,
      autoMerge: true,
    });
  });

  it("rejects removed definition metadata and a top-level branchName", () => {
    const result = parseDefinition(`
name: Legacy definition
description: No longer supported
branchName: legacy-branch
operations:
  - add:
      path: /LICENSE
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issues = result.issues.join(" ");
      expect(issues).toContain("name");
      expect(issues).toContain("description");
      expect(issues).toContain("branchName");
    }
  });

  it("normalizes operation fields to the domain model", () => {
    const definition = valid(`
  operations:
  - delete:
      path: /old.txt
      onFileMissing: skip
  - rename:
      from: /a/settings.json
      to: /a/config.json
  - replace:
      path: /azure-pipelines.yml
      find: "pool: Azure"
      replace: "pool: Self"
      useRegex: true
      flags: m
      onNoMatch: createIfMissing
`);

    expect(definition.operations[0]).toEqual({
      kind: "delete",
      path: "/old.txt",
      recursive: false,
      onFileMissing: "skip",
    });
    expect(definition.operations[1]).toEqual({
      kind: "rename",
      from: "/a/settings.json",
      to: "/a/config.json",
      onFileMissing: "error",
    });
    expect(definition.operations[2]).toEqual({
      kind: "replace",
      path: "/azure-pipelines.yml",
      find: "pool: Azure",
      replace: "pool: Self",
      useRegex: true,
      flags: "m",
      onNoMatch: "createIfMissing",
    });
  });

  it("accepts and normalizes a unified Git patch operation", () => {
    const definition = valid(`
operations:
  - applyPatch:
      patch: |
        diff --git a/README.md b/README.md
        --- a/README.md
        +++ b/README.md
        @@ -1 +1 @@
        -old
        +new
`);

    const operation = definition.operations[0];
    expect(operation.kind).toBe("applyPatch");
    if (operation.kind === "applyPatch") {
      expect(operation.patch).toContain("diff --git a/README.md b/README.md");
    }
  });

  it("rejects Git patch paths that escape the repository", () => {
    const result = parseDefinition(`
operations:
  - applyPatch:
      patch: |
        diff --git a/../outside.txt b/../outside.txt
        --- a/../outside.txt
        +++ b/../outside.txt
        @@ -1 +1 @@
        -old
        +new
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("stay inside the repository");
    }
  });

  it("rejects snake_case keys", () => {
    const result = parseDefinition(`
  write_mode: pull_request
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("write_mode");
    }
  });

  it("maps addContent with its defaults", () => {
    const definition = valid(`
  operations:
  - addContent:
      path: /README.md
      content: "credits"
`);
    expect(definition.operations[0]).toEqual({
      kind: "addContent",
      path: "/README.md",
      content: "credits",
      position: "end",
      lineNumber: null,
      skipIfPresent: true,
      onFileMissing: "error",
    });
  });

  it("requires lineNumber when addContent position is lineNumber", () => {
    const result = parseDefinition(`
  operations:
  - addContent:
      path: /README.md
      content: "credits"
      position: lineNumber
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("lineNumber is required");
    }
  });

  it("rejects an unknown addContent position", () => {
    const result = parseDefinition(`
  operations:
  - addContent:
      path: /README.md
      content: "credits"
      position: middle
`);
    expect(result.ok).toBe(false);
  });

  it("maps a recursive delete", () => {
    const definition = valid(`
  operations:
  - delete:
      path: /.vs
      recursive: true
`);
    expect(definition.operations[0]).toEqual({
      kind: "delete",
      path: "/.vs",
      recursive: true,
      onFileMissing: "error",
    });
  });

  it("rejects unknown keys", () => {
    const result = parseDefinition(`
  operations:
  - add:
      path: /LICENSE
      content: "x"
      unexpected: 1
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // zod 4 reports the offending location plus the unexpected key name.
      expect(result.issues.join(" ")).toContain("operations[0].add");
      expect(result.issues.join(" ")).toContain('Unrecognized key: "unexpected"');
    }
  });

  it("rejects the ambiguous onMissing operation field", () => {
    const result = parseDefinition(`
operations:
  - addContent:
      path: /README.md
      content: credits
      onMissing: skip
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("onMissing");
    }
  });

  it("rejects a top-level unknown key", () => {
    const result = parseDefinition(`
  operations:
  - add:
      path: /LICENSE
      content: "x"
glob: "**/*.ts"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("glob");
    }
  });

  it("requires at least one operation", () => {
    const result = parseDefinition("operations: []\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("at least one operation");
    }
  });

  it("rejects escaping paths", () => {
    const result = parseDefinition(`
  operations:
  - add:
      path: ../outside
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("operations[0].add.path");
    }
  });

  it("rejects multiple operations keys in one entry", () => {
    const result = parseDefinition(`
  operations:
  - add:
      path: /a
      content: "x"
    delete:
      path: /b
`);
    expect(result.ok).toBe(false);
  });

  it("reports invalid YAML clearly", () => {
    const result = parseDefinition("writeMode: Broken\n  bad indentation: [");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toContain("not valid YAML");
    }
  });

  it("rejects an empty document", () => {
    const result = parseDefinition("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toContain("empty");
    }
  });

  it("rejects a non-mapping document", () => {
    const result = parseDefinition("- add\n- delete");
    expect(result.ok).toBe(false);
  });

  it("rejects `branch` in pull-request mode", () => {
    const result = parseDefinition(`
writeMode: pullRequest
branch: feature/x
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("directCommit");
    }
  });

  it("rejects an invalid regex when useRegex is true", () => {
    const result = parseDefinition(`
  operations:
  - replace:
      path: /a.txt
      find: "(unclosed"
      replace: "y"
      useRegex: true
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("regular expression");
    }
  });

  it("rejects invalid regex flags", () => {
    const result = parseDefinition(`
  operations:
  - replace:
      path: /a.txt
      find: "x"
      replace: "y"
      useRegex: true
      flags: z
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("flags");
    }
  });

  it("keeps multi-line content blocks intact", () => {
    const definition = valid(`
  operations:
  - add:
      path: /LICENSE
      content: |
        line one
        line two
`);
    const op = definition.operations[0];
    expect(op.kind).toBe("add");
    if (op.kind === "add") {
      expect(op.content).toBe("line one\nline two\n");
    }
  });
});
