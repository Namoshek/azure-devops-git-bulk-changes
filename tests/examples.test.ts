import { EXAMPLES, parseExample } from "../src/features/bulkChanges/examples";

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

  it("includes an explanatory comment for every example operation", () => {
    const comments = {
      add: "# add a file",
      addContent: "# add content to an existing file",
      delete: "# delete a file or directory",
      rename: "# rename or move a file",
      replace: "# change file content",
    } as const;

    for (const example of EXAMPLES) {
      const result = parseExample(example.id);
      if (!result.ok) {
        throw new Error(result.issues.join("; "));
      }
      for (const operation of result.definition.operations) {
        expect(example.yaml).toContain(`  ${comments[operation.kind]}\n  - ${operation.kind}:`);
      }
    }
  });
});
