import {
  BaseFile,
  BulkChangeDefinition,
  BulkOperation,
  DEFAULT_LIMITS,
  RepoSnapshot,
  RepoTarget,
} from "../src/features/bulkChanges/types";
import { planRepository } from "../src/features/bulkChanges/planEngine";
import { VirtualWorkspace } from "../src/features/bulkChanges/workspace";
import { applyOperation } from "../src/features/bulkChanges/operations";
import { computeFileDiff } from "../src/features/bulkChanges/diff";
import { planToPushChanges } from "../src/features/bulkChanges/pushChanges";
import { parseDefinition } from "../src/features/bulkChanges/schema";

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

  it("emits a rename plus an edit when the content changed too", () => {
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

  it("delete honours onMissing", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/a.txt", "x")]);
    const remove = (path: string, onMissing: "error" | "skip", index: number) =>
      applyOperation(ws, { kind: "delete", path, recursive: false, onMissing }, index, context).severity;
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
      { kind: "delete", path: "/.vs", recursive: true, onMissing: "error" },
      0,
      context,
    );
    expect(result.severity).toBe("applied");
    expect(result.message).toContain("2 file(s)");
    expect(ws.paths()).toEqual(["/.vsx/keep.txt", "/README.md"]);
  });

  it("recursive delete honours onMissing for a missing directory", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/README.md", "x")]);
    const remove = (onMissing: "error" | "skip") =>
      applyOperation(ws, { kind: "delete", path: "/.vs", recursive: true, onMissing }, 0, context).severity;
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
          onMissing: "error",
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

    it("honours onMissing for a missing file", () => {
      expect(addContent([], { onMissing: "error" }).result.severity).toBe("error");
      expect(addContent([], { onMissing: "skip" }).result.severity).toBe("noop");

      const created = addContent([], { onMissing: "createIfMissing" });
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
      applyOperation(ws, { kind: "rename", from: "/nope", to: "/c.txt", onMissing: "error" }, 0, context).severity,
    ).toBe("error");
    expect(
      applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/b.txt", onMissing: "error" }, 1, context).severity,
    ).toBe("error");
    expect(
      applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/a.txt", onMissing: "error" }, 2, context).severity,
    ).toBe("error");
    const ok = applyOperation(ws, { kind: "rename", from: "/a.txt", to: "/c.txt", onMissing: "error" }, 3, context);
    expect(ok.severity).toBe("applied");
  });

  it("rename warns on a case-only collision", () => {
    const ws = VirtualWorkspace.fromBaseFiles([file("/Config.json", "x"), file("/legacy.json", "y")]);
    const result = applyOperation(
      ws,
      { kind: "rename", from: "/legacy.json", to: "/config.json", onMissing: "error" },
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
});

describe("planRepository", () => {
  it("reports would-change with the created file and its diff", () => {
    const { plan } = planOf(
      `name: Add
operations:
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
      `name: Add
operations:
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
      `name: Broken
operations:
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
      `name: Nested
operations:
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
    const listed = (path: string): BaseFile => ({
      path,
      content: null,
      objectId: `sha-${path}`,
      isBinary: false,
      skipReason: "its content was not loaded",
    });
    const { sourcePaths, plan } = planOf(
      `name: Delete dir
operations:
  - delete:
      path: /.vs
      recursive: true
`,
      [listed("/.vs/a.suo"), listed("/.vs/config/applicationhost.config"), file("/README.md", "x")],
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
  });

  it("applies operations in order, so add-then-replace works", () => {
    const { plan } = planOf(
      `name: Compose
operations:
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

  it("applies rename-then-replace as one rename plus one edit", () => {
    const { plan } = planOf(
      `name: Move then edit
operations:
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

  it("skips nothing but reports no-change for an empty repository with only missing-source skips", () => {
    const { plan } = planOf(
      `name: Skip everything
operations:
  - delete:
      path: /nope.txt
      onMissing: skip
  - rename:
      from: /nope.json
      to: /other.json
      onMissing: skip
`,
      [],
    );
    expect(plan.status).toBe("no-change");
    expect(plan.opResults.every((r) => r.severity === "noop")).toBe(true);
  });

  it("keeps the branch and target metadata", () => {
    const { plan } = planOf(
      `name: Add
operations:
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

  it("emits a rename before the edit of the renamed path", () => {
    const changes = planToPushChanges([
      { kind: "rename", from: "/a.txt", to: "/b.txt", content: "new", baseObjectId: "sha" },
      { kind: "edit", path: "/b.txt", content: "new", baseObjectId: "sha" },
    ]);
    expect(changes.map((c) => c.changeType)).toEqual(["rename", "edit"]);
    expect(changes[1].item.path).toBe("/b.txt");
  });
});
