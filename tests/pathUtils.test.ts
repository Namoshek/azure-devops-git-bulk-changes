import {
  normalizeGitPath,
  tryNormalizeGitPath,
  dirname,
  basename,
  isUnderPath,
  extension,
  isPathPattern,
  compilePathPattern,
  matchesPathPattern,
  patternScopePath,
} from "../src/domain/engine/pathUtils";
import { BulkChangeError } from "../src/domain/types";

describe("normalizeGitPath", () => {
  it("adds a leading slash and keeps POSIX separators", () => {
    expect(normalizeGitPath("LICENSE")).toBe("/LICENSE");
    expect(normalizeGitPath("/LICENSE")).toBe("/LICENSE");
    expect(normalizeGitPath("src\\main\\App.tsx")).toBe("/src/main/App.tsx");
  });

  it("collapses duplicate and trailing slashes", () => {
    expect(normalizeGitPath("//a//b//")).toBe("/a/b");
    expect(normalizeGitPath("./a/b")).toBe("/a/b");
  });

  it("rejects paths outside the repository", () => {
    expect(() => normalizeGitPath("../outside")).toThrow(BulkChangeError);
    expect(() => normalizeGitPath("/a/../b")).toThrow(BulkChangeError);
    expect(() => normalizeGitPath("")).toThrow(BulkChangeError);
    expect(() => normalizeGitPath("   ")).toThrow(BulkChangeError);
    expect(() => normalizeGitPath("/")).toThrow(BulkChangeError);
  });

  it("is case-sensitive", () => {
    expect(normalizeGitPath("/Readme.md")).toBe("/Readme.md");
    expect(tryNormalizeGitPath("/readme.md")).toBe("/readme.md");
  });

  it("returns null instead of throwing in tryNormalizeGitPath", () => {
    expect(tryNormalizeGitPath("/a/b")).toBe("/a/b");
    expect(tryNormalizeGitPath("..")).toBeNull();
  });
});

describe("path helpers", () => {
  it("derives dirname and basename", () => {
    expect(dirname("/a/b/c.txt")).toBe("/a/b");
    expect(dirname("/c.txt")).toBe("/");
    expect(basename("/a/b/c.txt")).toBe("c.txt");
    expect(basename("/c.txt")).toBe("c.txt");
  });

  it("detects nesting", () => {
    expect(isUnderPath("/a/b", "/a")).toBe(true);
    expect(isUnderPath("/a", "/a")).toBe(false);
    expect(isUnderPath("/a/b", "/")).toBe(true);
    expect(isUnderPath("/ab", "/a")).toBe(false);
  });

  it("derives extensions in lowercase", () => {
    expect(extension("/a/b/README.MD")).toBe("md");
    expect(extension("/Makefile")).toBe("");
    expect(extension("/a/.hidden")).toBe("");
  });
});

describe("isPathPattern", () => {
  it("flags glob metacharacters", () => {
    expect(isPathPattern("/src/*.ts")).toBe(true);
    expect(isPathPattern("/a/?x")).toBe(true);
    expect(isPathPattern("/a/[a-z]x")).toBe(true);
    expect(isPathPattern("/src/deep/App.tsx")).toBe(false);
  });
});

describe("compilePathPattern", () => {
  it("anchors the compiled expression", () => {
    expect(compilePathPattern("/a/*.ts").test("/a/b.ts")).toBe(true);
    expect(compilePathPattern("/a/*.ts").test("/a/b.ts/deeper.ts")).toBe(false);
  });

  it("rejects a pattern that is not root-relative-safe", () => {
    expect(() => compilePathPattern("../outside/*")).toThrow(BulkChangeError);
  });

  it("requires ** to be a whole segment", () => {
    expect(() => compilePathPattern("/src/a**b/*.ts")).toThrow(BulkChangeError);
  });

  it("rejects an unterminated character class", () => {
    expect(() => compilePathPattern("/src/[a-z.ts")).toThrow(BulkChangeError);
  });
});

describe("matchesPathPattern", () => {
  it("keeps a single star inside one path segment", () => {
    expect(matchesPathPattern("/src/*.ts", "/src/App.ts")).toBe(true);
    expect(matchesPathPattern("/src/*.ts", "/src/deep/App.ts")).toBe(false);
    expect(matchesPathPattern("/src/*.ts", "/src/App.tsx")).toBe(false);
  });

  it("spans directories with a trailing ** segment", () => {
    expect(matchesPathPattern("/src/**/*.ts", "/src/App.ts")).toBe(true);
    expect(matchesPathPattern("/src/**/*.ts", "/src/deep/inner/App.ts")).toBe(true);
    expect(matchesPathPattern("/src/**/*.ts", "/other/App.ts")).toBe(false);
  });

  it("matches any depth with a root ** pattern", () => {
    expect(matchesPathPattern("/**/*.yml", "/azure-pipelines.yml")).toBe(true);
    expect(matchesPathPattern("/**/*.yml", "/docs/a/b/c.yml")).toBe(true);
  });

  it("matches one character with ? and a range with a class", () => {
    expect(matchesPathPattern("/a/x?c", "/a/xac")).toBe(true);
    expect(matchesPathPattern("/a/x?c", "/a/xc")).toBe(false);
    expect(matchesPathPattern("/a/[a-c]file", "/a/bfile")).toBe(true);
    expect(matchesPathPattern("/a/[a-c]file", "/a/zfile")).toBe(false);
  });

  it("is case-sensitive like Git paths", () => {
    expect(matchesPathPattern("/src/*.ts", "/SRC/App.ts")).toBe(false);
  });

  it("escapes literal dots so they do not match any character", () => {
    expect(matchesPathPattern("/a/x.y", "/axay")).toBe(false);
    expect(matchesPathPattern("/a/x.y", "/a/x.y")).toBe(true);
  });

  it("normalizes the candidate path before matching", () => {
    expect(matchesPathPattern("/src/*.ts", "src/App.ts")).toBe(true);
    expect(matchesPathPattern("/src/*.ts", "/src/../src/App.ts")).toBe(false);
  });
});

describe("patternScopePath", () => {
  it("returns the longest literal directory prefix", () => {
    expect(patternScopePath("/src/**/*.ts")).toBe("/src");
    expect(patternScopePath("/docs/a/file.md")).toBe("/docs/a/file.md");
  });

  it("falls back to the repository root when the first segment matches", () => {
    expect(patternScopePath("/**/*.ts")).toBe("/");
    expect(patternScopePath("/a*/*.ts")).toBe("/");
  });
});
