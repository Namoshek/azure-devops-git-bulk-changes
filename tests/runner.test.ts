import { ApplyResult, BaseFile, BulkChangeError, RepoTarget, SourcePath } from "../src/domain/types";
import type { PullRequestRequest, PushRequest, RepoAccess } from "../src/domain/repoAccess";
import { applyRepos, branchFor, previewRepos } from "../src/services/runner";
import { mapWithConcurrency } from "../src/utils/concurrency";
import { parseDefinition } from "../src/domain/schema";

function definitionOf(yaml: string) {
  const result = parseDefinition(yaml);
  if (!result.ok) {
    throw new Error(result.issues.join("; "));
  }
  return result.definition;
}

function repo(name: string, repositoryId = name.toLowerCase()): RepoTarget {
  return {
    projectId: "p1",
    projectName: "Project",
    repositoryId,
    repositoryName: name,
    defaultBranch: "refs/heads/main",
    webUrl: `https://dev.example/Project/_git/${name}`,
  };
}

interface StubOptions {
  files?: Record<string, Record<string, string>>;
  commits?: Record<string, string>;
  binaryPaths?: string[];
  /** Repository ids where reading the branch fails. */
  unreadable?: string[];
  /** Repository ids where the push fails. */
  unwritable?: string[];
  pushError?: string;
}

/** In-memory `RepoAccess` for tests, recording every push and pull request. */
function createStub(options: StubOptions = {}) {
  const pushes: { target: RepoTarget; push: PushRequest }[] = [];
  const pullRequests: { target: RepoTarget; request: PullRequestRequest }[] = [];
  const reads: string[] = [];

  const access: RepoAccess = {
    async getBranchCommit(target) {
      if (options.unreadable?.includes(target.repositoryId)) {
        throw new BulkChangeError("no_access", `No access to ${target.repositoryName}.`);
      }
      return options.commits?.[target.repositoryId] ?? `commit-${target.repositoryId}`;
    },
    async readFiles(target, commit, sourcePaths: SourcePath[]): Promise<BaseFile[]> {
      reads.push(`${target.repositoryId}:${commit}`);
      const files = options.files?.[target.repositoryId] ?? {};
      const wanted = new Set<string>();
      for (const source of sourcePaths) {
        if (source.kind === "literal") {
          wanted.add(source.path);
        } else {
          const prefix = source.path === "/" ? "/" : `${source.path}/`;
          for (const path of Object.keys(files)) {
            if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
              wanted.add(path);
            }
          }
        }
      }

      return [...wanted]
        .filter((path) => files[path] !== undefined)
        .map((path) => {
          const isBinary = options.binaryPaths?.includes(path) ?? false;
          return isBinary
            ? { path, content: null, objectId: `blob-${path}`, isBinary: true, skipReason: "the file is binary" }
            : { path, content: files[path], objectId: `blob-${path}`, isBinary: false };
        });
    },
    async pushChanges(target, push) {
      if (options.unwritable?.includes(target.repositoryId)) {
        throw new BulkChangeError("push_denied", options.pushError ?? `Push to ${target.repositoryName} rejected.`);
      }
      pushes.push({ target, push });
      return {
        commitId: `new-commit-${pushes.length}`,
        newObjectId: `tip-${pushes.length}`,
      };
    },
    async createPullRequest(target, request) {
      pullRequests.push({ target, request });
      return { pullRequestId: pullRequests.length + 100 };
    },
  };

  return { access, pushes, pullRequests, reads };
}

const ADD_LICENSE = `
writeMode: directCommit
commitMessage: "Add LICENSE"
operations:
  - add:
      path: /LICENSE
      onlyIfMissing: true
      content: "MIT"
`;

const PR_MODE = `
writeMode: pullRequest
commitMessage: "Add LICENSE"
pullRequest:
  branchName: add-license
  title: "Add LICENSE"
  description: "body"
  draft: false
  autoMerge: true
operations:
  - add:
      path: /LICENSE
      onlyIfMissing: true
      content: "MIT"
`;

describe("branchFor", () => {
  it("uses the default branch in pull-request mode even when a branch is set", () => {
    const definition = definitionOf(PR_MODE);
    expect(branchFor(definition, repo("A"))).toBe("refs/heads/main");
  });

  it("uses the default branch in direct mode when no branch is given", () => {
    expect(branchFor(definitionOf(ADD_LICENSE), repo("A"))).toBe("refs/heads/main");
  });

  it("uses the explicit branch in direct mode", () => {
    const definition = definitionOf(`
writeMode: directCommit
branch: release/1.0
operations:
  - add:
      path: /a
      content: "x"
`);
    expect(branchFor(definition, repo("A"))).toBe("release/1.0");
  });
});

describe("previewRepos", () => {
  it("plans every repository independently", async () => {
    const { access } = createStub({
      files: { a: { "/README.md": "hi" }, b: { "/LICENSE": "MIT" } },
    });
    const plans = await previewRepos(access, definitionOf(ADD_LICENSE), [repo("A", "a"), repo("B", "b")]);

    expect(plans.map((p) => p.status)).toEqual(["would-change", "no-change"]);
    expect(plans[0].desired).toEqual([{ kind: "add", path: "/LICENSE", content: "MIT" }]);
    expect(plans[1].message).toContain("already satisfied");
  });

  it("turns a read failure into an error row without failing the run", async () => {
    const { access } = createStub({ files: { b: { "/README.md": "hi" } }, unreadable: ["a"] });
    const plans = await previewRepos(access, definitionOf(ADD_LICENSE), [repo("A", "a"), repo("B", "b")]);

    expect(plans[0].status).toBe("error");
    expect(plans[0].message).toContain("No access");
    expect(plans[1].status).toBe("would-change");
  });

  it("reports no-access on a file inside a readable repository", async () => {
    const access: RepoAccess = {
      async getBranchCommit() {
        return "sha";
      },
      async readFiles() {
        throw new BulkChangeError("no_access", "Permission denied.");
      },
      async pushChanges() {
        throw new Error("unused");
      },
      async createPullRequest() {
        throw new Error("unused");
      },
    };

    const plans = await previewRepos(access, definitionOf(ADD_LICENSE), [repo("A")]);
    expect(plans[0].status).toBe("error");
    expect(plans[0].message).toBe("Permission denied.");
  });

  it("marks binary files as untouchable and reports no-change", async () => {
    const { access } = createStub({ files: { a: { "/image.png": "" } }, binaryPaths: ["/image.png"] });
    const definition = definitionOf(`
operations:
  - replace:
      path: /image.png
      find: "x"
      replace: "y"
      onNoMatch: skip
`);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    expect(plans[0].status).toBe("no-change");
    expect(plans[0].opResults[0].severity).toBe("noop");
  });

  it("supports cancellation before a repository is read", async () => {
    const { access } = createStub({ files: { a: {}, b: {} } });
    let seen = 0;
    const plans = await previewRepos(
      access,
      definitionOf(ADD_LICENSE),
      [repo("A", "a"), repo("B", "b"), repo("C", "c")],
      {
        concurrency: 1,
        isCancelled: () => seen++ >= 1,
      },
    );

    expect(plans).toHaveLength(3);
    expect(plans[0].status).toBe("would-change");
    expect(plans[1].status).toBe("skipped");
    expect(plans[1].message).toContain("Cancelled");
    expect(plans[2].status).toBe("skipped");
  });

  it("reports progress as each repository finishes", async () => {
    const { access } = createStub({ files: { a: {}, b: {} } });
    const seen: number[] = [];
    const counts: string[] = [];
    await previewRepos(access, definitionOf(ADD_LICENSE), [repo("A", "a"), repo("B", "b")], {
      concurrency: 1,
      onProgress: (partial) => {
        seen.push(partial.length);
        counts.push(partial.map((p) => p.status).join(","));
      },
    });

    // Every repository reports once, and the last notification has all plans settled.
    expect(seen).toEqual([2, 2]);
    expect(counts[0]).toBe("would-change,pending");
    expect(counts[1]).toBe("would-change,would-change");
  });

  it("reads the branch tip once per repository and plans against it", async () => {
    const { access, reads } = createStub({ files: { a: {} }, commits: { a: "abc123" } });
    const plans = await previewRepos(access, definitionOf(ADD_LICENSE), [repo("A", "a")]);
    expect(plans[0].baseCommit).toBe("abc123");
    expect(reads).toEqual(["a:abc123"]);
  });
});

describe("applyRepos", () => {
  it("commits directly to the target branch", async () => {
    const { access, pushes, pullRequests } = createStub({ files: { a: {} } });
    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    const results = await applyRepos(access, definition, plans);

    expect(results[0].status).toBe("committed");
    expect(results[0].commitId).toBe("new-commit-1");
    expect(results[0].link).toBe("https://dev.example/Project/_git/A/commit/new-commit-1");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].push.refUpdates).toEqual([{ name: "refs/heads/main", oldObjectId: "commit-a" }]);
    expect(pushes[0].push.commits[0].comment).toBe("Add LICENSE");
    expect(pushes[0].push.commits[0].changes[0].changeType).toBe("add");
    expect(pullRequests).toHaveLength(0);
  });

  it("creates a branch and a pull request in pull-request mode", async () => {
    const { access, pushes, pullRequests } = createStub({ files: { a: {} } });
    const definition = definitionOf(PR_MODE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    const results: ApplyResult[] = await applyRepos(access, definition, plans);

    expect(results[0].status).toBe("pr-created");
    expect(results[0].pullRequestId).toBe(101);
    expect(results[0].link).toBe("https://dev.example/Project/_git/A/pullrequest/101");
    expect(pushes[0].push.refUpdates).toEqual([{ name: "refs/heads/add-license", oldObjectId: "commit-a" }]);
    expect(pullRequests[0].request).toEqual({
      sourceRefName: "refs/heads/add-license",
      targetRefName: "refs/heads/main",
      title: "Add LICENSE",
      description: "body",
      isDraft: false,
      autoMerge: true,
    });
  });

  it("retains the created pull request link when auto-complete setup fails", async () => {
    const { access } = createStub({ files: { a: {} } });
    access.createPullRequest = async () => ({
      pullRequestId: 101,
      autoCompleteWarning: "The request was denied.",
    });
    const definition = definitionOf(PR_MODE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    const results = await applyRepos(access, definition, plans);

    expect(results[0]).toMatchObject({
      status: "pr-created",
      message:
        "Created pull request !101 into refs/heads/main. Auto-complete could not be enabled: The request was denied.",
      pullRequestId: 101,
      link: "https://dev.example/Project/_git/A/pullrequest/101",
    });
  });

  it("re-reads the tip at apply time so a stale preview cannot overwrite newer work", async () => {
    let tip = "commit-a";
    const access: RepoAccess = {
      async getBranchCommit() {
        return tip;
      },
      async readFiles() {
        return [];
      },
      async pushChanges(_target, push) {
        return { commitId: "c1", newObjectId: push.refUpdates[0].oldObjectId };
      },
      async createPullRequest() {
        throw new Error("unused");
      },
    };

    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    expect(plans[0].baseCommit).toBe("commit-a");

    tip = "newer-tip";
    const results = await applyRepos(access, definition, plans);
    expect(results[0].status).toBe("committed");
    expect(results[0].commitId).toBe("c1");
  });

  it("skips repositories with no planned change", async () => {
    const { access, pushes } = createStub({ files: { a: { "/LICENSE": "MIT" } } });
    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    const results = await applyRepos(access, definition, plans);

    expect(results[0].status).toBe("skipped");
    expect(pushes).toHaveLength(0);
  });

  it("fails only the repository whose push is rejected", async () => {
    const { access, pushes } = createStub({
      files: { a: {}, b: {} },
      unwritable: ["a"],
      pushError: "TF402450: An item with the same name has already been created.",
    });
    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a"), repo("B", "b")]);
    const results = await applyRepos(access, definition, plans);

    expect(results[0].status).toBe("failed");
    expect(results[0].message).toContain("TF402450");
    expect(results[1].status).toBe("committed");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].target.repositoryId).toBe("b");
  });

  it("surfaces errors of plans that were already errors", async () => {
    const { access, pushes } = createStub({ files: { a: {} }, unreadable: ["a"] });
    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a")]);
    const results = await applyRepos(access, definition, plans);

    expect(results[0].status).toBe("failed");
    expect(results[0].message).toContain("No access");
    expect(pushes).toHaveLength(0);
  });

  it("supports cancellation before a repository is written", async () => {
    const { access, pushes } = createStub({ files: { a: {}, b: {} } });
    const definition = definitionOf(ADD_LICENSE);
    const plans = await previewRepos(access, definition, [repo("A", "a"), repo("B", "b")]);
    let seen = 0;
    const results = await applyRepos(access, definition, plans, {
      concurrency: 1,
      isCancelled: () => seen++ >= 1,
    });

    expect(results[0].status).toBe("committed");
    expect(results[1].status).toBe("skipped");
    expect(results[1].message).toContain("Cancelled");
    expect(pushes).toHaveLength(1);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order while limiting in-flight work", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it("propagates a rejection", async () => {
    await expect(mapWithConcurrency([1], 1, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
