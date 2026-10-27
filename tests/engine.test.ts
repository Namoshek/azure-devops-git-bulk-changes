import {
  BaseFile,
  BulkChangeDefinition,
  BulkOperation,
  BulkChangeError,
  DEFAULT_LIMITS,
  RepoSnapshot,
  RepoTarget,
} from "../src/domain/types";
import { planRepository } from "../src/domain/engine/planEngine";
import { VirtualWorkspace } from "../src/domain/engine/workspace";
import { applyOperation } from "../src/domain/engine/operations";
import { computeFileDiff } from "../src/domain/engine/diff";
import { planToPushChanges } from "../src/services/pushChanges";
import { parseDefinition } from "../src/domain/schema";

function file(path: string, content: string, objectId = `sha-${path}`): BaseFile {
  return { path, content, objectId, isBinary: false };
}

function binaryFile(path: string, skipReason = "the file is binary"): BaseFile {
  return { path, content: null, objectId: `sha-${path}`, isBinary: true, skipReason };
}

const target: RepoTarget = {
  projectId: "p1",
  projectName: "Project",
  repositoryId: "r1",
  repositoryName: "Repo",
  defaultBranch: "refs/heads/main",
};

function definitionOf(yaml: string): BulkChangeDefinition {
  const result = parseDefinition(yaml);
  if (!result.ok) {
    throw new Error(result.issues.join("; "));
  }
  return result.definition;
}

function snapshotOf(commit: string, files: BaseFile[]): RepoSnapshot {
  return { commit, files };
}

function planOf(yaml: string, files: BaseFile[], commit = "base-sha") {
  const definition = definitionOf(yaml);
  return planRepository(target, definition, snapshotOf(commit, files), "refs/heads/main", { limits: DEFAULT_LIMITS });
}

describe("VirtualWorkspace", () => {
  it("round-trips base files with normalized paths", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("a/b.txt", "x")]);
    expect(ws.get("/a/b.txt")?.content).toBe("x");
    expect(ws.paths()).toEqual(["/a/b.txt"]);
  });

  it("renames only when the target is free", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x"), file("/b.txt", "y")]);
    expect(ws.rename("/a.txt", "/b.txt")).toBe(false);
    expect(ws.rename("/a.txt", "/c.txt")).toBe(true);
    expect(ws.get("/c.txt")?.content).toBe("x");
    expect(ws.get("/c.txt")?.originalPath).toBe("/a.txt");
    expect(ws.has("/a.txt")).toBe(false);
  });

  it("reports case-insensitive collisions", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/Readme.md", "x")]);
    expect(ws.caseInsensitiveCollisions("/README.md")).toEqual(["/Readme.md"]);
    expect(ws.caseInsensitiveCollisions("/other.md")).toEqual([]);
  });

  it("detects no changes for untouched files", () => {
    const base = [file("/a.txt", "x")];
    const ws = VirtualWorkspace.fromBaseFiles(base);
    expect(ws.describeChanges(base)).toEqual([]);
  });

  it("emits add, edit, delete and rename changes", () => {
    const base = [
      file("/keep.txt", "same"),
      file("/edit.txt", "old"),
      file("/gone.txt", "bye"),
      file("/move.txt", "move-me"),
    ];
    const ws = VirtualWorkspace.fromBaseFiles(base);
    ws.set("/new.txt", "created");
    ws.set("/edit.txt", "new");
    ws.remove("/gone.txt");
    ws.rename("/move.txt", "/moved.txt");

    expect(ws.describeChanges(base)).toEqual([
      { kind: "edit", path: "/edit.txt", content: "new", baseObjectId: "sha-/edit.txt" },
      { kind: "rename", from: "/move.txt", to: "/moved.txt", content: "move-me", baseObjectId: "sha-/move.txt" },
      { kind: "add", path: "/new.txt", content: "created" },
      { kind: "delete", path: "/gone.txt", baseObjectId: "sha-/gone.txt" },
    ]);
  });

  it("emits a rename plus an edit when the renamed file content changes", () => {
    const base = [file("/a.txt", "old")];
    const ws = VirtualWorkspace.fromBaseFiles(base);
    ws.rename("/a.txt", "/b.txt");
    ws.set("/b.txt", "new");
    expect(ws.describeChanges(base)).toEqual([
      { kind: "rename", from: "/a.txt", to: "/b.txt", content: "new", baseObjectId: "sha-/a.txt" },
      { kind: "edit", path: "/b.txt", content: "new", baseObjectId: "sha-/a.txt" },
    ]);
  });

  it("never rewrites files whose content could not be read", () => {
    const base = [binaryFile("/image.png")];
    const ws = VirtualWorkspace.fromBaseFiles(base);
    expect(ws.describeChanges(base)).toEqual([]);
  });

  it("allows moving a binary file without content", () => {
    const base = [binaryFile("/image.png")];
    const ws = VirtualWorkspace.fromBaseFiles(base);
    ws.rename("/image.png", "/assets/image.png");
    expect(ws.describeChanges(base)).toEqual([
      { kind: "rename", from: "/image.png", to: "/assets/image.png", content: null, baseObjectId: "sha-/image.png" },
    ]);
  });
});

describe("applyOperation", () => {
  const context = { limits: DEFAULT_LIMITS };

  it("add creates a missing file and no-ops when onlyIfMissing is set", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/LICENSE", "existing")]);
    const add = { kind: "add" as const, path: "/LICENSE", content: "new", onlyIfMissing: true };
    expect(applyOperation(ws, add, 0, context).severity).toBe("noop");
    expect(ws.get("/LICENSE")?.content).toBe("existing");

    const missing = { kind: "add" as const, path: "/README.md", content: "hello", onlyIfMissing: true };
    expect(applyOperation(ws, missing, 1, context).severity).toBe("applied");
    expect(ws.get("/README.md")?.content).toBe("hello");
  });

  it("add overwrites when onlyIfMissing is false", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "old")]);
    const result = applyOperation(
      ws,
      { kind: "add", path: "/a.txt", content: "new", onlyIfMissing: false },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(ws.get("/a.txt")?.content).toBe("new");
  });

  it("add fails on a binary file it cannot overwrite", () => {
    const ws = VirtualWorkspace.fromBaseFiles([binaryFile("/image.png")]);
    const result = applyOperation(
      ws,
      { kind: "add", path: "/image.png", content: "x", onlyIfMissing: false },
      0,
      context,
    );
    expect(result.severity).toBe("error");
    expect(result.message).toContain("binary");
  });

  it("applies a multi-file Git patch in one workspace operation", () => {
    const patch = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+added
`;
    const ws = VirtualWorkspace.fromBaseFiles([file("/README.md", "old\n")]);
    const result = applyOperation(ws, { kind: "applyPatch", patch, allowPartial: false }, 0, context);

    expect(result.severity).toBe("applied");
    expect(ws.get("/README.md")?.content).toBe("new\n");
    expect(ws.get("/new.txt")?.content).toBe("added\n");
  });

  it("does not partially apply a multi-file patch when a later hunk fails", () => {
    const patch = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
diff --git a/config.txt b/config.txt
--- a/config.txt
+++ b/config.txt
@@ -1 +1 @@
-missing
+changed
`;
    const ws = VirtualWorkspace.fromBaseFiles([file("/README.md", "old\n"), file("/config.txt", "current\n")]);

    expect(() => applyOperation(ws, { kind: "applyPatch", patch, allowPartial: false }, 0, context)).toThrow(
      /do not match/,
    );
    expect(ws.get("/README.md")?.content).toBe("old\n");
    expect(ws.get("/config.txt")?.content).toBe("current\n");

    const partialWs = VirtualWorkspace.fromBaseFiles([file("/README.md", "old\n"), file("/config.txt", "current\n")]);
    const partial = applyOperation(partialWs, { kind: "applyPatch", patch, allowPartial: true }, 0, context);
    expect(partial.severity).toBe("warning");
    expect(partial.message).toContain("partially applied");
    expect(partial.message).toContain("config.txt");
    expect(partialWs.get("/README.md")?.content).toBe("new\n");
    expect(partialWs.get("/config.txt")?.content).toBe("current\n");
  });

  it("skips patch files whose source is missing when allowPartial is set", () => {
    const patch = `diff --git a/gone.txt b/gone.txt
--- a/gone.txt
+++ b/gone.txt
@@ -1 +1 @@
-old
+new
`;
    const ws = VirtualWorkspace.fromBaseFiles([file("/other.txt", "x")]);
    expect(() => applyOperation(ws, { kind: "applyPatch", patch, allowPartial: true }, 0, context)).toThrow(
      /No file patch/,
    );
    expect(ws.get("/other.txt")?.content).toBe("x");
  });

  it("delete honours onFileMissing", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x")]);
    const remove = (path: string, onFileMissing: "error" | "skip", index: number) =>
      applyOperation(ws, { kind: "delete", path, recursive: false, onFileMissing }, index, context).severity;
    expect(remove("/missing.txt", "skip", 0)).toBe("noop");
    expect(remove("/missing.txt", "error", 1)).toBe("error");
    expect(remove("/a.txt", "error", 2)).toBe("applied");
    expect(ws.has("/a.txt")).toBe(false);
  });

  it("recursive delete removes a directory and everything below it", () => {
    const ws = VirtualWorkspace.fromBaseFiles([
      file("/.vs/a.suo", "1"),
      file("/.vs/config/applicationhost.config", "2"),
      file("/.vsx/keep.txt", "3"),
      file("/README.md", "4"),
    ]);
    const result = applyOperation(
      ws,
      { kind: "delete", path: "/.vs", recursive: true, onFileMissing: "error" },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(result.message).toContain("2 file(s)");
    expect(ws.paths()).toEqual(["/.vsx/keep.txt", "/README.md"]);
  });

  it("recursive delete honours onFileMissing for a missing directory", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/README.md", "x")]);
    const remove = (onFileMissing: "error" | "skip") =>
      applyOperation(ws, { kind: "delete", path: "/.vs", recursive: true, onFileMissing }, 0, context).severity;
    expect(remove("skip")).toBe("noop");
    expect(remove("error")).toBe("error");
  });

  describe("addContent", () => {
    const addContent = (files: BaseFile[], overrides: Partial<Extract<BulkOperation, { kind: "addContent" }>> = {}) => {
      const ws = VirtualWorkspace.fromBaseFiles(files);
      const result = applyOperation(
        ws,
        {
          kind: "addContent",
          path: "/README.md",
          content: "credits",
          position: "end",
          lineNumber: null,
          skipIfPresent: true,
          onFileMissing: "error",
          ...overrides,
        },
        0,
        context,
      );
      return { ws, result };
    };

    it("appends at the end, adding the missing line break first", () => {
      const { ws, result } = addContent([file("/README.md", "# Title")]);
      expect(result.severity).toBe("applied");
      expect(ws.get("/README.md")?.content).toBe("# Title\ncredits\n");
    });

    it("appends after a trailing line break without a blank line", () => {
      const { ws } = addContent([file("/README.md", "# Title\n")]);
      expect(ws.get("/README.md")?.content).toBe("# Title\ncredits\n");
    });

    it("prepends at the start", () => {
      const { ws } = addContent([file("/README.md", "# Title\n")], { position: "start" });
      expect(ws.get("/README.md")?.content).toBe("credits\n# Title\n");
    });

    it("inserts before the given line number", () => {
      const { ws } = addContent([file("/README.md", "one\ntwo\nthree\n")], { position: "lineNumber", lineNumber: 2 });
      expect(ws.get("/README.md")?.content).toBe("one\ncredits\ntwo\nthree\n");
    });

    it("treats the line after the last one as the end, even without a trailing line break", () => {
      const { ws } = addContent([file("/README.md", "one\ntwo")], { position: "lineNumber", lineNumber: 3 });
      expect(ws.get("/README.md")?.content).toBe("one\ntwo\ncredits\n");
    });

    it("errors when the line number is beyond the end of the file", () => {
      const { result } = addContent([file("/README.md", "one\ntwo\n")], { position: "lineNumber", lineNumber: 9 });
      expect(result.severity).toBe("error");
      expect(result.message).toContain("2 line(s)");
    });

    it("keeps the file's CRLF line endings", () => {
      const { ws } = addContent([file("/README.md", "one\r\ntwo\r\n")], { content: "a\nb" });
      expect(ws.get("/README.md")?.content).toBe("one\r\ntwo\r\na\r\nb\r\n");
    });

    it("is a no-op when the file already contains the content", () => {
      const { ws, result } = addContent([file("/README.md", "# Title\n\ncredits\n")], { content: "\ncredits\n" });
      expect(result.severity).toBe("noop");
      expect(ws.get("/README.md")?.content).toBe("# Title\n\ncredits\n");
    });

    it("adds the content again when skipIfPresent is false", () => {
      const { ws, result } = addContent([file("/README.md", "credits\n")], { skipIfPresent: false });
      expect(result.severity).toBe("applied");
      expect(ws.get("/README.md")?.content).toBe("credits\ncredits\n");
    });

    it("honours onFileMissing for a missing file", () => {
      expect(addContent([], { onFileMissing: "error" }).result.severity).toBe("error");
      expect(addContent([], { onFileMissing: "skip" }).result.severity).toBe("noop");

      const created = addContent([], { onFileMissing: "createIfMissing" });
      expect(created.result.severity).toBe("applied");
      expect(created.ws.get("/README.md")?.content).toBe("credits\n");
    });

    it("errors on a file whose content cannot be read", () => {
      const { result } = addContent([binaryFile("/README.md")]);
      expect(result.severity).toBe("error");
      expect(result.message).toContain("binary");
    });
  });

  it("rename errors on a missing source, an occupied target and an identical path", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x"), file("/b.txt", "y")]);
    expect(
      applyOperation(ws, { kind: "rename", from: "/nope", to: "/c.txt", onFileMissing: "error" }, 0, context).severity,
    ).toBe("error");
    expect(
      applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/b.txt", onFileMissing: "error" }, 1, context).severity,
    ).toBe("error");
    expect(
      applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/a.txt", onFileMissing: "error" }, 2, context).severity,
    ).toBe("error");
    const ok = applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/c.txt", onFileMissing: "error" }, 3, context);
    expect(ok.severity).toBe("applied");
  });

  it("rename warns on a case-only collision", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/Config.json", "x"), file("/legacy.json", "y")]);
    const result = applyOperation(
      ws,
      { kind: "rename", from: "/legacy.json", to: "/config.json", onFileMissing: "error" },
      0,
      context,
    );
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("Config.json");
  });

  it("replace literal applies to every occurrence", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "foo bar foo")]);
    const result = applyOperation(
      ws,
      { kind: "replace", path: "/a.txt", find: "foo", replace: "baz", useRegex: false, flags: "m", onNoMatch: "error" },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(ws.get("/a.txt")?.content).toBe("baz bar baz");
    expect(result.message).toContain("2 replacement");
  });

  it("replace treats regex metacharacters literally when useRegex is false", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "a.b + c")]);
    applyOperation(
      ws,
      { kind: "replace", path: "/a.txt", find: "a.b", replace: "x", useRegex: false, flags: "m", onNoMatch: "error" },
      0,
      context,
    );
    expect(ws.get("/a.txt")?.content).toBe("x + c");
  });

  it("replace supports regex groups and flags", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "POOL=a\npool=b\n")]);
    applyOperation(
      ws,
      {
        kind: "replace",
        path: "/a.txt",
        find: "pool=(\\w)",
        replace: "pool[$1]",
        useRegex: true,
        flags: "gm",
        onNoMatch: "error",
      },
      0,
      context,
    );
    expect(ws.get("/a.txt")?.content).toBe("POOL=a\npool[b]\n");
  });

  it("replace honours onNoMatch", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "content")]);
    const op = (onNoMatch: "error" | "skip" | "createIfMissing") =>
      applyOperation(
        ws,
        { kind: "replace", path: "/a.txt", find: "absent", replace: "x", useRegex: false, flags: "m", onNoMatch },
        0,
        context,
      );
    expect(op("skip").severity).toBe("noop");
    expect(op("error").severity).toBe("error");
    expect(op("createIfMissing").severity).toBe("warning");
    expect(ws.get("/a.txt")?.content).toBe("content");
  });

  it("replace creates the file when it is missing and onNoMatch is createIfMissing", () => {
    const ws = VirtualWorkspace.fromBaseFiles([]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: "/new.txt",
        find: "x",
        replace: "created",
        useRegex: false,
        flags: "m",
        onNoMatch: "createIfMissing",
      },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(ws.get("/new.txt")?.content).toBe("created");
  });

  it("replace is a no-op when the replacement equals the original", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "same")]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: "/a.txt",
        find: "same",
        replace: "same",
        useRegex: false,
        flags: "m",
        onNoMatch: "error",
      },
      0,
      context,
    );
    expect(result.severity).toBe("noop");
  });

  it("replace refuses to grow a file past the size limit", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x")]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: "/a.txt",
        find: "x",
        replace: "y".repeat(50),
        useRegex: false,
        flags: "m",
        onNoMatch: "error",
      },
      0,
      {
        limits: { ...DEFAULT_LIMITS, maxFileChars: 10 },
      },
    );
    expect(result.severity).toBe("error");
    expect(result.message).toContain("character limit");
  });

  it("replace skips unreadable files when onNoMatch is skip", () => {
    const ws = VirtualWorkspace.fromBaseFiles([binaryFile("/image.png")]);
    const result = applyOperation(
      ws,
      { kind: "replace", path: "/image.png", find: "x", replace: "y", useRegex: false, flags: "m", onNoMatch: "skip" },
      0,
      context,
    );
    expect(result.severity).toBe("noop");
  });

  it("throws on an invalid regex instead of reporting a result, unless onNoMatch is skip", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x")]);
    const bad = {
      kind: "replace" as const,
      path: "/a.txt",
      find: "(unclosed",
      replace: "y",
      useRegex: true,
      flags: "m",
      onNoMatch: "error" as const,
    };
    expect(() => applyOperation(ws, bad, 0, context)).toThrow(/regular expression/);
    expect(applyOperation(ws, { ...bad, onNoMatch: "skip" }, 1, context).severity).toBe("noop");
  });

  it("fans a pattern operation out into a single result carrying the matched paths", () => {
    const ws = VirtualWorkspace.fromBaseFiles([
      file("/src/a.ts", "pool: Azure"),
      file("/src/deep/b.ts", "pool: Azure"),
      file("/README.md", "pool: Azure"),
    ]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: null,
        pathPattern: "/src/**/*.ts",
        find: "pool: Azure",
        replace: "pool: Self",
        useRegex: false,
        flags: "",
        onNoMatch: "error",
      },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(result.path).toBe("/src/**/*.ts");
    expect(result.matchedPaths).toEqual(["/src/a.ts", "/src/deep/b.ts"]);
    expect(result.message).toContain("matched 2 file(s)");
    expect(result.message).toContain("2 would change");
    expect(ws.get("/src/a.ts")?.content).toBe("pool: Self");
    expect(ws.get("/README.md")?.content).toBe("pool: Azure");
  });

  it("reports a fan-out as one error row when any matched file cannot be processed", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/src/a.ts", "x"), file("/src/b.ts", "unrelated")]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: null,
        pathPattern: "/src/*.ts",
        find: "x",
        replace: "y",
        useRegex: false,
        flags: "",
        onNoMatch: "error",
      },
      0,
      context,
    );
    expect(result.severity).toBe("error");
    expect(result.matchedPaths).toEqual(["/src/a.ts", "/src/b.ts"]);
    expect(result.message).toContain("1 could not be processed");
  });

  it("treats a fan-out where every file is already satisfied as a no-op", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/src/a.ts", "pool: Self"), file("/src/b.ts", "pool: Self")]);
    const result = applyOperation(
      ws,
      {
        kind: "replace",
        path: null,
        pathPattern: "/src/*.ts",
        find: "pool: Azure",
        replace: "pool: Self",
        useRegex: false,
        flags: "",
        onNoMatch: "skip",
      },
      0,
      context,
    );
    expect(result.severity).toBe("noop");
    expect(result.message).toContain("every one is already satisfied");
  });

  it("reports a zero-match pattern as a no-op or throws per patternNoMatch", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/README.md", "x")]);
    const op = {
      kind: "replace" as const,
      path: null as string | null,
      pathPattern: "/src/*.ts",
      find: "x",
      replace: "y",
      useRegex: false,
      flags: "",
      onNoMatch: "error" as const,
    };
    const skipped = applyOperation(ws, { ...op, patternNoMatch: "skip" as const }, 0, context);
    expect(skipped.severity).toBe("noop");
    expect(skipped.message).toContain("matches no file");
    expect(skipped.matchedPaths).toEqual([]);
    expect(() => applyOperation(ws, { ...op, patternNoMatch: "error" as const }, 1, context)).toThrow(BulkChangeError);
  });

  it("refuses a fan-out over the match cap instead of changing part of the files", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/src/a.ts", "x"), file("/src/b.ts", "x"), file("/src/c.ts", "x")]);
    expect(() =>
      applyOperation(
        ws,
        {
          kind: "replace",
          path: null,
          pathPattern: "/src/*.ts",
          find: "x",
          replace: "y",
          useRegex: false,
          flags: "",
          onNoMatch: "error",
        },
        0,
        { limits: { ...DEFAULT_LIMITS, maxMatchedFiles: 2 } },
      ),
    ).toThrow(/above the 2 limit/);
    expect(ws.get("/src/a.ts")?.content).toBe("x");
  });
});

describe("planRepository", () => {
  it("reads patch paths before planning and previews the patched content", () => {
    const { sourcePaths, plan } = planOf(
      `operations:
  - applyPatch:
      patch: |
        diff --git a/README.md b/README.md
        --- a/README.md
        +++ b/README.md
        @@ -1 +1 @@
        -old
        +new
`,
      [file("/README.md", "old\n")],
    );

    expect(sourcePaths).toEqual([{ kind: "literal", path: "/README.md" }]);
    expect(plan.status).toBe("would-change");
    expect(plan.desired).toEqual([
      { kind: "edit", path: "/README.md", content: "new\n", baseObjectId: "sha-/README.md" },
    ]);
    expect(plan.diffs[0].diff).toContain("+new");
  });

  it("reports would-change with the created file and its diff", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /LICENSE
      content: "MIT"
`,
      [file("/README.md", "hi")],
    );

    expect(plan.status).toBe("would-change");
    expect(plan.baseCommit).toBe("base-sha");
    expect(plan.desired).toEqual([{ kind: "add", path: "/LICENSE", content: "MIT" }]);
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0].path).toBe("/LICENSE");
    expect(plan.diffs[0].additions).toBe(1);
    expect(plan.opResults[0].severity).toBe("applied");
  });

  it("reports no-change when the file already has the content", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /LICENSE
      onlyIfMissing: true
      content: "MIT"
`,
      [file("/LICENSE", "MIT")],
    );
    expect(plan.status).toBe("no-change");
    expect(plan.desired).toEqual([]);
    expect(plan.diffs).toEqual([]);
    expect(plan.message).toContain("already satisfied");
  });

  it("fails the whole repository when one operation errors", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /LICENSE
      content: "MIT"
  - delete:
      path: /missing.txt
`,
      [file("/README.md", "hi")],
    );

    expect(plan.status).toBe("error");
    expect(plan.message).toContain("/missing.txt does not exist");
    expect(plan.desired).toEqual([]);
    expect(plan.diffs).toEqual([]);
    expect(plan.opResults[0].severity).toBe("applied");
    expect(plan.opResults[1].severity).toBe("error");
  });

  it("reads nested directories from the top-level directory only", () => {
    const { sourcePaths } = planOf(
      `operations:
  - replace:
      path: /src/main.ts
      find: "a"
      replace: "b"
`,
      [file("/src/main.ts", "a"), file("/src/deep/other.ts", "a"), file("/README.md", "x")],
    );

    expect(sourcePaths).toEqual([
      { kind: "directory", path: "/src", maxEntries: 50 },
      { kind: "literal", path: "/src/main.ts" },
    ]);
  });

  it("reads a recursive delete as a whole tree and deletes every listed file", () => {
    const { sourcePaths, plan } = planOf(
      `operations:
  - delete:
      path: /.vs
      recursive: true
`,
      [
        file("/.vs/a.suo", "text one\ntext two\n"),
        binaryFile("/.vs/config/applicationhost.config"),
        file("/README.md", "x"),
      ],
    );

    expect(sourcePaths).toEqual([{ kind: "tree", path: "/.vs", maxEntries: 1000 }]);
    expect(plan.status).toBe("would-change");
    expect(plan.desired).toEqual([
      { kind: "delete", path: "/.vs/a.suo", baseObjectId: "sha-/.vs/a.suo" },
      {
        kind: "delete",
        path: "/.vs/config/applicationhost.config",
        baseObjectId: "sha-/.vs/config/applicationhost.config",
      },
    ]);
    // The text file renders its full content as removed lines; the binary one only shows the headers.
    const textDiff = plan.diffs.find((diff) => diff.path === "/.vs/a.suo");
    const binaryDiff = plan.diffs.find((diff) => diff.path === "/.vs/config/applicationhost.config");
    expect(textDiff?.diff).toContain("--- a/.vs/a.suo");
    expect(textDiff?.diff).toContain("-text one");
    expect(textDiff?.diff).toMatch(/^@@ -1,2 \+0,0 @@$/m);
    expect(binaryDiff?.diff).toContain("--- a/.vs/config/applicationhost.config");
    expect(binaryDiff?.diff?.includes("--- /dev/null")).toBe(false);
    expect(binaryDiff?.additions).toBe(0);
    expect(binaryDiff?.deletions).toBe(0);
  });

  it("collects a pathPattern as a single pattern source instead of a literal path", () => {
    const { sourcePaths } = planOf(
      `operations:
  - replace:
      pathPattern: "/src/**/*.ts"
      find: "pool: Azure"
      replace: "pool: Self"
`,
      [],
    );

    expect(sourcePaths).toEqual([{ kind: "pattern", path: "/src/**/*.ts", maxEntries: 500 }]);
  });

  it("plans a pattern fan-out as one row with matched paths and one diff per matched file", () => {
    const { plan } = planOf(
      `operations:
  - replace:
      pathPattern: "/src/**/*.ts"
      find: "pool: Azure"
      replace: "pool: Self"
`,
      [file("/src/a.ts", "pool: Azure"), file("/src/deep/b.ts", "pool: Azure"), file("/README.md", "other")],
    );

    expect(plan.status).toBe("would-change");
    expect(plan.opResults).toHaveLength(1);
    expect(plan.opResults[0].path).toBe("/src/**/*.ts");
    expect(plan.opResults[0].matchedPaths).toEqual(["/src/a.ts", "/src/deep/b.ts"]);
    expect(plan.desired).toHaveLength(2);
    expect(plan.diffs).toHaveLength(2);
    expect(plan.diffs.map((diff) => diff.path)).toEqual(["/src/a.ts", "/src/deep/b.ts"]);
  });

  it("composes a fan-out with earlier operations, so a created file is matched too", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /src/new.ts
      content: "pool: Azure"
  - replace:
      pathPattern: "/src/*.ts"
      find: "pool: Azure"
      replace: "pool: Self"
`,
      [file("/src/old.ts", "pool: Azure")],
    );

    expect(plan.status).toBe("would-change");
    expect(plan.opResults[1].matchedPaths).toEqual(["/src/new.ts", "/src/old.ts"]);
    // The created file was matched by the later pattern, so it collapses to one add plus one edit for the old file.
    expect(plan.desired).toEqual([
      { kind: "add", path: "/src/new.ts", content: "pool: Self" },
      { kind: "edit", path: "/src/old.ts", content: "pool: Self", baseObjectId: "sha-/src/old.ts" },
    ]);
  });

  it("keeps a zero-match pattern a no-op by default and errors the repository when set to error", () => {
    const { plan: skipped } = planOf(
      `operations:
  - delete:
      pathPattern: "/docs/*.md"
`,
      [file("/README.md", "x")],
    );
    expect(skipped.status).toBe("no-change");
    expect(skipped.desired).toEqual([]);
    expect(skipped.opResults[0].severity).toBe("noop");

    const { plan: failed } = planOf(
      `operations:
  - delete:
      pathPattern: "/docs/*.md"
      patternNoMatch: error
`,
      [file("/README.md", "x")],
    );
    expect(failed.status).toBe("error");
    expect(failed.desired).toEqual([]);
    expect(failed.message).toContain("matches no file");
  });

  it("refuses the repository when a pattern matches more than the cap", () => {
    const { plan } = planRepository(
      target,
      definitionOf(
        `operations:
  - delete:
      pathPattern: "/src/*.ts"
`,
      ),
      snapshotOf("base-sha", [file("/src/a.ts", "x"), file("/src/b.ts", "x"), file("/src/c.ts", "x")]),
      "refs/heads/main",
      { limits: { ...DEFAULT_LIMITS, maxMatchedFiles: 2 } },
    );

    expect(plan.status).toBe("error");
    expect(plan.desired).toEqual([]);
    expect(plan.diffs).toEqual([]);
    expect(plan.message).toContain("above the 2 limit");
    expect(plan.opResults[0].path).toBe("/src/*.ts");
  });

  it("applies operations in order, so add-then-replace works", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /config.yml
      content: "pool: Azure\\n"
  - replace:
      path: /config.yml
      find: "pool: Azure"
      replace: "pool: Self"
`,
      [],
    );

    expect(plan.status).toBe("would-change");
    expect(plan.desired).toEqual([{ kind: "add", path: "/config.yml", content: "pool: Self\n" }]);
  });

  it("applies rename-then-replace as a rename plus an edit", () => {
    const { plan } = planOf(
      `operations:
  - rename:
      from: /settings.json
      to: /config.json
  - replace:
      path: /config.json
      find: "old"
      replace: "new"
`,
      [file("/settings.json", "old value")],
    );

    expect(plan.status).toBe("would-change");
    expect(plan.desired).toEqual([
      {
        kind: "rename",
        from: "/settings.json",
        to: "/config.json",
        content: "new value",
        baseObjectId: "sha-/settings.json",
      },
      { kind: "edit", path: "/config.json", content: "new value", baseObjectId: "sha-/settings.json" },
    ]);
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0].originalPath).toBe("/settings.json");
    expect(plan.diffs[0].diff).toContain("rename from settings.json");
    expect(plan.diffs[0].diff).toContain("rename to config.json");
  });

  it("pushes a rename-with-hunks Git patch as one change for the destination", () => {
    const { plan } = planOf(
      `operations:
  - applyPatch:
      patch: |-
        diff --git a/Old.cs b/New.cs
        similarity index 90%
        rename from Old.cs
        rename to New.cs
        --- a/Old.cs
        +++ b/New.cs
        @@ -1 +1 @@
        -old
        +new
`,
      [file("/Old.cs", "old\n")],
    );

    expect(plan.status).toBe("would-change");
    expect(planToPushChanges(plan.desired)).toEqual([
      { changeType: "add", item: { path: "/New.cs" }, newContent: { content: "new\n", contentType: "rawtext" } },
      { changeType: "delete", item: { path: "/Old.cs" } },
    ]);
  });

  it("skips nothing but reports no-change for an empty repository with only missing-source skips", () => {
    const { plan } = planOf(
      `operations:
  - delete:
      path: /nope.txt
      onFileMissing: skip
  - rename:
      from: /nope.json
      to: /other.json
      onFileMissing: skip
`,
      [],
    );
    expect(plan.status).toBe("no-change");
    expect(plan.opResults.every((r) => r.severity === "noop")).toBe(true);
  });

  it("keeps the branch and target metadata", () => {
    const { plan } = planOf(
      `operations:
  - add:
      path: /a
      content: "x"
`,
      [],
    );
    expect(plan.target).toEqual(target);
    expect(plan.branch).toBe("refs/heads/main");
  });
});

describe("computeFileDiff", () => {
  it("renders an added file as a full addition", () => {
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: null,
      originalContent: null,
      newContent: "one\ntwo\n",
      maxDiffLines: 100,
    });
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
    expect(diff.diff).toContain("--- /dev/null");
    expect(diff.diff).toContain("+++ b/a.txt");
    expect(diff.diff).toContain("+one");
    expect(diff.diff).toContain("+two");
  });

  it("renders a deleted file as a full removal", () => {
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: "/a.txt",
      originalContent: "one\n",
      newContent: null,
      maxDiffLines: 100,
    });
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(1);
    expect(diff.diff).toContain("--- a/a.txt");
    expect(diff.diff).toContain("+++ /dev/null");
    expect(diff.diff).toContain("-one");
    expect(diff.diff).toMatch(/^@@ -1,1 \+0,0 @@$/m);
  });

  it("keeps the source header for a delete whose content was never loaded", () => {
    const diff = computeFileDiff({
      path: "/deep/nested.bin",
      originalPath: "/deep/nested.bin",
      originalContent: null,
      newContent: null,
      maxDiffLines: 100,
    });
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.diff).toContain("--- a/deep/nested.bin");
    expect(diff.diff).toContain("+++ /dev/null");
    expect(diff.diff.includes("--- /dev/null")).toBe(false);
  });

  it("renders context, additions and deletions with hunk headers", () => {
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: "/a.txt",
      originalContent: "keep1\nkeep2\nold\nkeep3\n",
      newContent: "keep1\nkeep2\nnew\nkeep3\n",
      maxDiffLines: 100,
    });
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.diff).toMatch(/^@@ -1,4 \+1,4 @@$/m);
    expect(diff.diff).toContain(" keep1");
    expect(diff.diff).toContain("-old");
    expect(diff.diff).toContain("+new");
  });

  it("separates distant changes into multiple hunks", () => {
    const original = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const changed = original.replace("line 2", "changed 2").replace("line 35", "changed 35");
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: "/a.txt",
      originalContent: original,
      newContent: changed,
      maxDiffLines: 1000,
    });
    const hunks = diff.diff.split("\n").filter((line) => line.startsWith("@@"));
    expect(hunks).toHaveLength(2);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });

  it("truncates oversized diffs", () => {
    const original = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const changed = Array.from({ length: 200 }, (_, i) => `changed ${i}`).join("\n");
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: "/a.txt",
      originalContent: original,
      newContent: changed,
      maxDiffLines: 20,
    });
    expect(diff.diff.split("\n").length).toBeLessThanOrEqual(21);
    expect(diff.diff).toContain("diff truncated");
    expect(diff.additions).toBe(200);
    expect(diff.deletions).toBe(200);
  });

  it("emits a rename header without content lines for a pure move", () => {
    const diff = computeFileDiff({
      path: "/new.txt",
      originalPath: "/old.txt",
      originalContent: "same\n",
      newContent: "same\n",
      maxDiffLines: 100,
    });
    expect(diff.originalPath).toBe("/old.txt");
    expect(diff.diff).toContain("diff --git a/old.txt b/new.txt");
    expect(diff.diff).toContain("rename from old.txt");
    expect(diff.diff).toContain("rename to new.txt");
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.diff).not.toContain("+same");
    expect(diff.diff).not.toContain("@@");

    const workspace = VirtualWorkspace.fromBaseFiles([file("/old.txt", "same\n")]);
    const result = applyOperation(workspace, { kind: "applyPatch", patch: diff.diff, allowPartial: false }, 0, {
      limits: DEFAULT_LIMITS,
    });
    expect(result.severity).toBe("applied");
    expect(workspace.get("/old.txt")).toBeUndefined();
    expect(workspace.get("/new.txt")?.content).toBe("same\n");
  });

  it("normalizes CRLF line endings for display", () => {
    const diff = computeFileDiff({
      path: "/a.txt",
      originalPath: "/a.txt",
      originalContent: "a\r\nb\r\n",
      newContent: "a\nb\n",
      maxDiffLines: 100,
    });
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });
});

describe("planToPushChanges", () => {
  it("maps domain changes onto the push change types", () => {
    const changes = planToPushChanges([
      { kind: "add", path: "/new.txt", content: "hi" },
      { kind: "edit", path: "/a.txt", content: "x", baseObjectId: "sha" },
      { kind: "delete", path: "/b.txt", baseObjectId: "sha" },
      { kind: "rename", from: "/c.txt", to: "/d.txt", content: null, baseObjectId: "sha" },
    ]);

    expect(changes).toEqual([
      { changeType: "rename", sourceServerItem: "/c.txt", item: { path: "/d.txt" } },
      { changeType: "add", item: { path: "/new.txt" }, newContent: { content: "hi", contentType: "rawtext" } },
      { changeType: "edit", item: { path: "/a.txt" }, newContent: { content: "x", contentType: "rawtext" } },
      { changeType: "delete", item: { path: "/b.txt" } },
    ]);
  });

  it("writes a content-changing rename as an add and delete", () => {
    const changes = planToPushChanges([
      { kind: "rename", from: "/a.txt", to: "/b.txt", content: "new", baseObjectId: "sha" },
      { kind: "edit", path: "/b.txt", content: "new", baseObjectId: "sha" },
    ]);
    expect(changes).toEqual([
      { changeType: "add", item: { path: "/b.txt" }, newContent: { content: "new", contentType: "rawtext" } },
      { changeType: "delete", item: { path: "/a.txt" } },
    ]);
  });
});
