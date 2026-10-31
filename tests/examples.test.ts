import { EXAMPLES, parseExample } from "../src/domain/examples";

describe("built-in examples", () => {
  it.each(EXAMPLES.map((example) => example.id))("%s is a valid definition", (id) => {
    const result = parseExample(id);
    if (!result.ok) {
      throw new Error(result.issues.join("; "));
    }
    expect(result.definition.operations.length).toBeGreaterThan(0);
  });

  it("deletes the .vs directory recursively", () => {
    const result = parseExample("delete-vs-directory");
    expect(result.ok && result.definition.operations[0]).toMatchObject({
      kind: "delete",
      path: "/.vs",
      recursive: true,
      onFileMissing: "skip",
    });
  });

  it("appends the credits to the end of README.md", () => {
    const result = parseExample("add-readme-credits");
    expect(result.ok && result.definition.operations[0]).toMatchObject({
      kind: "addContent",
      path: "/README.md",
      position: "end",
      skipIfPresent: true,
    });
  });

  it("applies a Git patch to update the agent pool", () => {
    const result = parseExample("apply-patch");
    expect(result.ok && result.definition.operations[0]).toMatchObject({ kind: "applyPatch" });
    expect(result.ok && result.definition.operations[0]).toHaveProperty(
      "patch",
      expect.stringContaining("diff --git a/azure-pipelines.yml"),
    );
  });

  it("carries no explanatory comments, since schema hover provides the metadata", () => {
    for (const example of EXAMPLES) {
      expect(example.yaml).not.toMatch(/^\s*# (add|change|delete|rename|apply)/m);
    }
  });
});
