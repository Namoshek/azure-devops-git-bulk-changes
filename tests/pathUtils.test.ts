import {
  normalizeGitPath,
  tryNormalizeGitPath,
  dirname,
  basename,
  isUnderPath,
  extension,
} from "../src/features/bulkChanges/pathUtils";
import { BulkChangeError } from "../src/features/bulkChanges/types";

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
