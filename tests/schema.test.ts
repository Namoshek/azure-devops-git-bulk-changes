import { definitionJsonSchema, parseDefinition } from "../src/domain/schema";

interface JsonSchemaView {
  $schema?: string;
  additionalProperties?: boolean;
  anyOf?: JsonSchemaView[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaView;
  oneOf?: JsonSchemaView[];
  properties?: Record<string, JsonSchemaView>;
  required?: string[];
  title?: string;
}

function valid(definition: string) {
  const result = parseDefinition(definition);
  if (!result.ok) {
    throw new Error(`Expected valid definition, got issues: ${result.issues.join("; ")}`);
  }
  return result.definition;
}

describe("parseDefinition", () => {
  it("converts the definition schema to an input JSON Schema for Monaco", () => {
    const schema = JSON.parse(JSON.stringify(definitionJsonSchema)) as JsonSchemaView;
    const properties = schema.properties ?? {};
    const operations = properties.operations;
    const branches = operations?.items?.anyOf ?? operations?.items?.oneOf ?? [];
    const add = branches.find((branch) => branch.properties?.add);
    const addContent = branches.find((branch) => branch.properties?.addContent);
    const addContentSchema = addContent?.properties?.addContent;

    expect(schema.$schema).toContain("draft-07");
    expect(schema.required).toContain("operations");
    expect(schema.required).not.toContain("writeMode");
    expect(properties.writeMode?.enum).toEqual(["directCommit", "pullRequest"]);
    expect(properties.writeMode?.description).toContain("directly");
    expect(properties.writeMode?.title).toBe("How changes are written");
    expect(add?.properties?.add?.description).toContain("Add a new file");
    expect(add?.properties?.add?.title).toBe("Add a new file");
    expect(addContent?.additionalProperties).toBe(false);
    expect(addContentSchema?.properties?.position?.enum).toEqual(["start", "end", "lineNumber"]);
    expect(addContentSchema?.properties?.position?.title).toBe("Insertion point");
    expect(addContentSchema?.properties?.position?.description).toContain("Where the content is inserted");
    expect(addContentSchema?.properties?.onFileMissing?.enum).toEqual(["error", "skip", "createIfMissing"]);
  });

  it("accepts a minimal add definition and applies defaults", () => {
    const definition = valid(`
  operations:
  - add:
      path: /LICENSE
      content: "hello"
`);

    expect(definition.operations).toHaveLength(1);
    expect(definition.operations[0]).toEqual({ kind: "add", path: "/LICENSE", content: "hello", onlyIfMissing: false });
    expect(definition.writeMode).toBe("pullRequest");
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
      pathPattern: null,
      patternNoMatch: "skip",
      recursive: false,
      onFileMissing: "skip",
    });
    expect(definition.operations[1]).toEqual({
      kind: "rename",
      from: "/a/settings.json",
      to: "/a/config.json",
      recursive: false,
      onFileMissing: "error",
    });
    expect(definition.operations[2]).toEqual({
      kind: "replace",
      path: "/azure-pipelines.yml",
      pathPattern: null,
      patternNoMatch: "skip",
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
      expect(operation.allowPartial).toBe(false);
    }
  });

  it("accepts the allowPartial flag on a Git patch operation", () => {
    const definition = valid(`
operations:
  - applyPatch:
      allowPartial: true
      patch: |
        diff --git a/README.md b/README.md
        --- a/README.md
        +++ b/README.md
        @@ -1 +1 @@
        -old
        +new
`);
    const operation = definition.operations[0];
    if (operation.kind === "applyPatch") {
      expect(operation.allowPartial).toBe(true);
    } else {
      throw new Error("expected an applyPatch operation");
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
      pathPattern: null,
      patternNoMatch: "skip",
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
      pathPattern: null,
      patternNoMatch: "skip",
      recursive: true,
      onFileMissing: "error",
    });
  });

  it("maps a recursive rename", () => {
    const definition = valid(`
  operations:
  - rename:
      from: /old
      to: /new
      recursive: true
`);
    expect(definition.operations[0]).toEqual({
      kind: "rename",
      from: "/old",
      to: "/new",
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

  it("accepts pathPattern and normalizes the pattern field", () => {
    const definition = valid(`
  operations:
  - replace:
      pathPattern: "/src/**/*.ts"
      find: "pool: Azure"
      replace: "pool: Self"
      patternNoMatch: error
`);
    const operation = definition.operations[0];
    expect(operation.kind).toBe("replace");
    if (operation.kind === "replace") {
      expect(operation.path).toBeNull();
      expect(operation.pathPattern).toBe("/src/**/*.ts");
      expect(operation.patternNoMatch).toBe("error");
    }
  });

  it("defaults patternNoMatch to skip", () => {
    const definition = valid(`
  operations:
  - delete:
      pathPattern: "/docs/*.md"
`);
    const operation = definition.operations[0];
    if (operation.kind === "delete") {
      expect(operation.patternNoMatch).toBe("skip");
    }
  });

  it("rejects wildcard metacharacters in an exact path", () => {
    const result = parseDefinition(`
  operations:
  - replace:
      path: /src/*.ts
      find: a
      replace: b
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("use pathPattern");
    }
  });

  it("rejects a pathPattern without a wildcard", () => {
    const result = parseDefinition(`
  operations:
  - delete:
      pathPattern: /src/exact.ts
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("must use a wildcard");
    }
  });

  it("rejects an operation that gives both path and pathPattern", () => {
    const result = parseDefinition(`
  operations:
  - replace:
      path: /a.ts
      pathPattern: "/src/*.ts"
      find: a
      replace: b
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("exactly one of");
    }
  });

  it("rejects recursive together with pathPattern", () => {
    const result = parseDefinition(`
  operations:
  - delete:
      pathPattern: "/src/*.ts"
      recursive: true
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("'recursive' is not supported");
    }
  });

  it("keeps add on exact paths only", () => {
    const result = parseDefinition(`
  operations:
  - add:
      path: /src/*.ts
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("use pathPattern");
    }
  });

  it("rejects an unbalanced bracket in a pattern", () => {
    const result = parseDefinition(`
  operations:
  - replace:
      pathPattern: "/src/[a-z.ts"
      find: a
      replace: b
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("operations[0].replace.pathPattern");
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

  it("maps Zod diagnostics to the invalid YAML value", () => {
    const yaml = "operations:\n  - add:\n      path: ../outside\n      content: x\n";
    const result = parseDefinition(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diagnostic = result.diagnostics.find((item) => item.path.join(".") === "operations.0.add.path");
      expect(diagnostic).toBeDefined();
      expect(yaml.slice(diagnostic?.startOffset, diagnostic?.endOffset)).toBe("../outside");
    }
  });

  it("maps unknown-key diagnostics to the YAML key", () => {
    const yaml = "operations:\n  - add:\n      path: /LICENSE\n      content: x\n      unexpected: true\n";
    const result = parseDefinition(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diagnostic = result.diagnostics.find((item) => item.path[item.path.length - 1] === "unexpected");
      expect(diagnostic).toBeDefined();
      expect(yaml.slice(diagnostic?.startOffset, diagnostic?.endOffset)).toBe("unexpected");
    }
  });

  it("maps semantic diagnostics to their YAML field", () => {
    const yaml = [
      "operations:",
      "  - replace:",
      '      pathPattern: "/src/[a-z.ts"',
      "      find: a",
      "      replace: b",
    ].join("\n");
    const result = parseDefinition(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diagnostic = result.diagnostics.find((item) => item.code === "custom");
      expect(diagnostic).toBeDefined();
      expect(yaml.slice(diagnostic?.startOffset, diagnostic?.endOffset)).toBe('"/src/[a-z.ts"');
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
      expect(result.diagnostics[0].startOffset).toBeDefined();
      expect(result.diagnostics[0].endOffset).toBeDefined();
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

  it("accepts `branch` as the pull-request base branch", () => {
    const definition = valid(`
writeMode: pullRequest
branch: feature/x
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(definition.branch).toBe("feature/x");
  });

  it("rejects a `refs/heads/` prefix", () => {
    const result = parseDefinition(`
writeMode: directCommit
branch: refs/heads/release/1.0
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("plain branch name");
    }
  });

  it("rejects a tag ref as the branch target", () => {
    const result = parseDefinition(`
writeMode: directCommit
branch: refs/tags/v1.0
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("not a ref such as");
    }
  });

  it("rejects branch names Git would refuse to push", () => {
    const result = parseDefinition(`
writeMode: directCommit
branch: feature..x
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("valid Git branch name");
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
