import { parseDefinition } from "../src/features/bulkChanges/schema";

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
name: Add file
operations:
  - add:
      path: /LICENSE
      content: "hello"
`);

    expect(definition.operations).toHaveLength(1);
    expect(definition.operations[0]).toEqual({ kind: "add", path: "/LICENSE", content: "hello", onlyIfMissing: false });
    expect(definition.writeMode).toBe("directCommit");
    expect(definition.branch).toBeNull();
    expect(definition.branchName).toBe("bulk-changes");
    expect(definition.commitMessage).toBe("Apply bulk changes");
    expect(definition.pullRequestDraft).toBe(false);
  });

  it("maps pullRequest write mode and pull request settings", () => {
    const definition = valid(`
name: PR mode
writeMode: pullRequest
branchName: bulk/add-license
commitMessage: "Add LICENSE"
pullRequest:
  title: "Add LICENSE"
  description: "body"
  draft: true
operations:
  - add:
      path: /LICENSE
      content: "x"
`);
    expect(definition.writeMode).toBe("pullRequest");
    expect(definition.branchName).toBe("bulk/add-license");
    expect(definition.pullRequestTitle).toBe("Add LICENSE");
    expect(definition.pullRequestDescription).toBe("body");
    expect(definition.pullRequestDraft).toBe(true);
  });

  it("normalizes operation fields to the domain model", () => {
    const definition = valid(`
name: Mixed operations
operations:
  - delete:
      path: /old.txt
      onMissing: skip
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
      onMissing: "skip",
    });
    expect(definition.operations[1]).toEqual({
      kind: "rename",
      from: "/a/settings.json",
      to: "/a/config.json",
      onMissing: "error",
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

  it("rejects snake_case keys", () => {
    const result = parseDefinition(`
name: Old style
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
name: Credits
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
      onMissing: "error",
    });
  });

  it("requires lineNumber when addContent position is lineNumber", () => {
    const result = parseDefinition(`
name: Credits
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
name: Credits
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
name: Delete dir
operations:
  - delete:
      path: /.vs
      recursive: true
`);
    expect(definition.operations[0]).toEqual({
      kind: "delete",
      path: "/.vs",
      recursive: true,
      onMissing: "error",
    });
  });

  it("rejects unknown keys", () => {
    const result = parseDefinition(`
name: Bad key
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

  it("rejects a top-level unknown key", () => {
    const result = parseDefinition(`
name: Bad
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
    const result = parseDefinition("name: Empty\noperations: []\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("at least one operation");
    }
  });

  it("rejects escaping paths", () => {
    const result = parseDefinition(`
name: Escape
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
name: Two ops
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
    const result = parseDefinition("name: Broken\n  bad indentation: [");
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
name: Branch in PR
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
name: Bad regex
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
name: Bad flags
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
name: Multiline
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
