import { parseDocument, Scalar, YAMLMap, YAMLParseError, YAMLSeq } from "yaml";
import type { Node } from "yaml";
import { z } from "zod";
import {
  AddContentOperation,
  AddOperation,
  ApplyPatchOperation,
  BulkChangeDefinition,
  BulkOperation,
  ContentPosition,
  DeleteOperation,
  MissingFileBehavior,
  MissingSourceBehavior,
  NoMatchBehavior,
  PatternMatchBehavior,
  RenameOperation,
  ReplaceOperation,
} from "./types";
import { compilePathPattern, isPathPattern, tryNormalizeGitPath } from "./engine/pathUtils";
import { parseGitPatch } from "./engine/gitPatch";

const VALID_FLAGS = /^[igmusvy]*$/;

const pathField = z
  .string()
  .min(1, "must be a non-empty path")
  .refine((value) => tryNormalizeGitPath(value) !== null, "must be a repository-root-relative path without '..'")
  .refine((value) => !isPathPattern(value), "path must name one exact file; use pathPattern for wildcard matching")
  .meta({
    title: "Exact file path",
    description:
      "The path to a single file, relative to the repository root. For example: '/README.md'. It must start " +
      "with '/' and must not contain '..' segments or wildcard characters.\n" +
      "Some operations offer a 'pathPattern' alternative that allows wildcard matching to work with multiple files at once.",
  });

/** A glob-style path pattern. It must carry a wildcard so it can never masquerade as a literal path. */
const patternField = z
  .string()
  .min(1, "must be a non-empty pattern")
  .refine((value) => tryNormalizeGitPath(value) !== null, "must be a repository-root-relative pattern without '..'")
  .refine((value) => isPathPattern(value), "must use a wildcard (*, ? or [..]) — use path for an exact file")
  .meta({
    title: "Wildcard file pattern",
    description:
      "A repository-root-relative glob pattern that selects several files at once, such as " +
      "'/src/**/*.ts'. '**' matches across directories while '*', '?' and '[..]' stay inside a " +
      "single file name; the pattern must contain a wildcard and must not use '..' segments.",
  });

const flagsField = z
  .string()
  .refine((value) => VALID_FLAGS.test(value), "may only contain the flags i, m, s, u, v, y")
  .meta({
    title: "Regular expression flags",
    description:
      "JavaScript regular expression flags applied to the search pattern, written as plain letters " +
      "without separators (for example 'im'). Only the flags i, g, m, s, u, v and y are accepted.",
  });

/**
 * Branch names used by `branch` and `pullRequest.branchName`.
 *
 * Only plain names (`release/1.0`) are accepted. Any `refs/...` form is rejected, including
 * `refs/heads/`: it is redundant here, and reads resolve arbitrary refs while `GitPush` only ever
 * accepts `refs/heads/...`, so a tag or other ref would be readable but impossible to commit to.
 */
const BRANCH_RULES: Array<[pattern: RegExp, message: string]> = [
  [/^\//, "must not start with '/'"],
  [/\/$/, "must not end with '/'"],
  [
    /\/\/|\.\.|^-|-$|\.$|\.lock$/,
    "must be a valid Git branch name (no '..', leading or trailing '-', trailing '.lock')",
  ],
  [/^refs\//i, "must be a plain branch name, not a ref such as 'refs/heads/' or 'refs/tags/'"],
  [/[^\x20-\x7e]/, "must only contain printable ASCII characters"],
  [/[\s"'`#?&;\\|^*[\](){}<>=+!,$@%]/, "must not contain whitespace or Git-reserved characters"],
];

function checkBranch(value: string): string | null {
  for (const [pattern, message] of BRANCH_RULES) {
    if (pattern.test(value)) {
      return message;
    }
  }
  return null;
}

const branchField = z
  .string()
  .min(1, "must not be empty")
  .superRefine((value, context) => {
    const message = checkBranch(value);
    if (message) {
      context.addIssue({ code: "custom", message });
    }
  })
  .meta({
    title: "Git branch name",
    description:
      "A plain Git branch name such as 'release/1.0'. Refs forms like 'refs/heads/main' are " +
      "rejected because only plain branches can receive these commits. The name must not be empty, " +
      "start or end with '-' or '/', contain '..' or consecutive slashes, end with '.lock', or use " +
      "characters reserved by Git such as whitespace, quotes, or '*'.",
  });

const addSchema = z.strictObject({
  add: z
    .strictObject({
      path: pathField,
      content: z.string().meta({
        title: "File content",
        description:
          "The full text content of the file to create. Use a YAML block scalar such as '|' " +
          "for multi-line text, which preserves the line breaks of the license or README.",
      }),
      onlyIfMissing: z
        .boolean()
        .default(false)
        .meta({
          title: "Keep an existing file",
          description:
            "When true, a file that already exists at the path is left untouched and the " +
            "operation reports that nothing was added, which makes the definition safe to re-run. " +
            "When false (the default), an existing file is overwritten with the new content.",
        }),
    })
    .meta({
      title: "Add a new file",
      description:
        "Add a new file with the given content at an exact repository path. An existing file is " +
        "overwritten unless onlyIfMissing protects it, and a binary or unreadable file causes an error.",
    }),
});

const addContentSchema = z.strictObject({
  addContent: z
    .strictObject({
      path: pathField
        .nullable()
        .default(null)
        .meta({
          title: "Exact file path",
          description:
            "The single file to modify. Give exactly one of 'path' or 'pathPattern': use this key " +
            "for one exact file, and use pathPattern to change many files with a single operation.",
        }),
      pathPattern: patternField
        .nullable()
        .default(null)
        .meta({
          title: "Wildcard file pattern",
          description:
            "Instead of a single file, selects every file whose path matches this glob pattern. " +
            "Give exactly one of 'path' or 'pathPattern'.",
        }),
      content: z.string().meta({
        title: "Text to insert",
        description:
          "The text inserted into each selected file. It is added as one or more whole lines, " +
          "and its line endings are converted to match the file's existing style.",
      }),
      position: z
        .enum(["start", "end", "lineNumber"])
        .default("end")
        .meta({
          title: "Insertion point",
          description:
            "Where the content is inserted in each selected file. 'start' prepends it, 'end' " +
            "appends it (the default), and 'lineNumber' inserts it before the line numbered " +
            "1-based in lineNumber. Inserting beyond the last line of a file reports an error.",
        }),
      lineNumber: z
        .number()
        .int()
        .min(1, "must be 1 or greater")
        .nullable()
        .default(null)
        .meta({
          title: "Insertion line number",
          description:
            "The line before which the content is inserted, numbered from 1. Only used when " +
            "position is 'lineNumber'; the other positions ignore it. A number greater than the " +
            "file's line count reports an error.",
        }),
      skipIfPresent: z
        .boolean()
        .default(true)
        .meta({
          title: "Skip when content exists",
          description:
            "When true (the default), a file that already contains this text is left unchanged, " +
            "which makes repeated runs idempotent. Set it to false to insert the text again " +
            "even when it is already there.",
        }),
      onFileMissing: z
        .enum(["error", "skip", "createIfMissing"])
        .default("error")
        .meta({
          title: "Missing file handling",
          description:
            "What happens when a selected file does not exist in the repository. 'error' (the " +
            "default) reports the operation as failed, 'skip' leaves it untouched, and " +
            "'createIfMissing' creates the file so that it contains only the inserted content.",
        }),
      patternNoMatch: z
        .enum(["error", "skip"])
        .default("skip")
        .meta({
          title: "Pattern without matches",
          description:
            "What happens when pathPattern selects no files at all. 'error' reports the " +
            "operation as failed, and 'skip' (the default) reports that there was nothing to do. " +
            "This setting is ignored when path is used instead of pathPattern.",
        }),
    })
    .superRefine((op, context) => {
      if ((op.path === null) === (op.pathPattern === null)) {
        context.addIssue({ code: "custom", message: "must give exactly one of 'path' or 'pathPattern'" });
      }
    })
    .meta({
      title: "Add content to existing files",
      description:
        "Insert text into one exact file or into every file selected by a pattern. The position " +
        "key chooses start, end or a numbered line, and skipIfPresent keeps re-runs idempotent.",
    }),
});

const gitPatchField = z
  .string()
  .min(1, "must not be empty")
  .superRefine((patch, context) => {
    try {
      parseGitPatch(patch);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "must be a valid textual Git patch",
      });
    }
  })
  .meta({
    title: "Git patch text",
    description:
      "A textual Git unified diff, such as the output of 'git diff'. Generate it for a commit " +
      "with 'git show --format= --no-ext-diff --no-color --find-renames <commit>'. Patches that " +
      "only change file modes, and patches containing binary files, are not supported.",
  });

const applyPatchSchema = z.strictObject({
  applyPatch: z
    .strictObject({
      patch: gitPatchField,
      allowPartial: z
        .boolean()
        .default(false)
        .meta({
          title: "Skip files the patch cannot apply",
          description:
            "When true, parts of the patch whose source file is missing from a repository are " +
            "skipped instead of failing, which suits one patch applied to repositories that " +
            "diverge slightly. When false (the default), every file the patch touches must exist " +
            "and match its content, or the operation reports an error.",
        }),
    })
    .meta({
      title: "Apply a Git patch",
      description:
        "Apply a textual Git unified diff to the repository, creating, deleting, or editing the " +
        "files the patch touches. Every file the patch reads comes from the repository's base commit.",
    }),
});

const deleteSchema = z.strictObject({
  delete: z
    .strictObject({
      path: pathField
        .nullable()
        .default(null)
        .meta({
          title: "Exact path to delete",
          description:
            "The single file to delete, or the directory to delete when recursive is true. " +
            "Give exactly one of 'path' or 'pathPattern': use pathPattern to delete many files " +
            "with one operation.",
        }),
      pathPattern: patternField
        .nullable()
        .default(null)
        .meta({
          title: "Wildcard file pattern",
          description:
            "Selects every file whose path matches this glob pattern for deletion. " +
            "Give exactly one of 'path' or 'pathPattern'.",
        }),
      recursive: z
        .boolean()
        .default(false)
        .meta({
          title: "Delete a whole directory",
          description:
            "When true, path names a directory and the directory together with every file " +
            "beneath it is deleted. When false (the default), path must name a single file. " +
            "This key cannot be combined with pathPattern, which already selects files " +
            "explicitly.",
        }),
      onFileMissing: z
        .enum(["error", "skip"])
        .default("error")
        .meta({
          title: "Missing file handling",
          description:
            "What happens when the path does not exist in the repository. 'error' (the default) " +
            "reports the operation as failed, and 'skip' reports that there was nothing to " +
            "delete, which keeps re-runs quiet.",
        }),
      patternNoMatch: z
        .enum(["error", "skip"])
        .default("skip")
        .meta({
          title: "Pattern without matches",
          description:
            "What happens when pathPattern selects no files at all. 'error' reports the " +
            "operation as failed, and 'skip' (the default) reports that there was nothing to " +
            "do. This setting is ignored when path is used instead of pathPattern.",
        }),
    })
    .superRefine((op, context) => {
      if ((op.path === null) === (op.pathPattern === null)) {
        context.addIssue({ code: "custom", message: "must give exactly one of 'path' or 'pathPattern'" });
      }
      if (op.pathPattern !== null && op.recursive) {
        context.addIssue({
          code: "custom",
          message: "'recursive' is not supported when 'pathPattern' already selects files",
        });
      }
    })
    .meta({
      title: "Delete files or directories",
      description:
        "Delete a single file at an exact path, a whole directory tree when recursive is true, " +
        "or every file selected by pathPattern.",
    }),
});

const renameSchema = z.strictObject({
  rename: z
    .strictObject({
      from: pathField.meta({
      title: "Existing file or folder to move",
        description:
        "The path of the file to rename or move. When recursive is true, this names a folder root " +
        "and all tracked files beneath it are moved. pathPattern is not available here.",
      }),
      to: pathField.meta({
      title: "New file path or folder root",
        description:
        "The path the file is moved to. When recursive is true, this names the destination folder " +
        "root, which must not contain tracked files.",
      }),
      recursive: z
      .boolean()
      .default(false)
      .meta({
        title: "Move a whole folder",
        description:
          "When true, from and to name folder roots. Every tracked file under from moves to the " +
          "corresponding path under to, preserving relative paths. The source must contain at least " +
          "one tracked file, destination tree must be empty, roots must not overlap, and the move " +
          "is limited to 1,000 files.",
      }),
      onFileMissing: z
      .enum(["error", "skip"])
        .default("error")
        .meta({
          title: "Missing file handling",
          description:
            "What happens when the source file does not exist, or the source folder is empty when " +
            "recursive is true. 'error' (the default) reports failure; 'skip' reports that there " +
            "was nothing to move.",
        }),
    })
    .meta({
      title: "Rename or move files or folders",
      description:
        "Move one file by default. With recursive true, move every tracked file in a folder while " +
        "preserving relative paths. Destination conflicts fail, and case-only collisions are reported.",
    }),
});

const replaceSchema = z.strictObject({
  replace: z
    .strictObject({
      path: pathField
        .nullable()
        .default(null)
        .meta({
          title: "Exact file path",
          description:
            "The single file to modify. Give exactly one of 'path' or 'pathPattern': use this " +
            "key for one exact file, and use pathPattern to change many files with a single " +
            "operation.",
        }),
      pathPattern: patternField
        .nullable()
        .default(null)
        .meta({
          title: "Wildcard file pattern",
          description:
            "Instead of a single file, selects every file whose path matches this glob pattern. " +
            "Give exactly one of 'path' or 'pathPattern'.",
        }),
      find: z
        .string()
        .min(1, "must not be empty")
        .meta({
          title: "Text or pattern to find",
          description:
            "The literal text to search for in each selected file, or the JavaScript regular " +
            "expression to match when useRegex is true. It must not be empty.",
        }),
      replace: z.string().meta({
        title: "Replacement text",
        description:
          "The text that replaces every match in each selected file. When useRegex is true, " +
          "references like '$&' or '$1' in this text insert parts of each match.",
      }),
      useRegex: z
        .boolean()
        .default(false)
        .meta({
          title: "Match as regular expression",
          description:
            "When true, find is interpreted as a JavaScript regular expression, modified by " +
            "flags. When false (the default), find is plain text matched exactly as written.",
        }),
      flags: flagsField.default("m").meta({
        title: "Search pattern flags",
        description:
          "The regular expression flags applied to find, only used when useRegex is true. " +
          "Defaults to 'm', which makes ^ and $ match at every line of the file. " +
          "Multiple flags can be provided, e.g. 'im'.",
      }),
      onNoMatch: z
        .enum(["error", "skip", "createIfMissing"])
        .default("error")
        .meta({
          title: "No match handling",
          description:
            "What happens when a selected file does not contain the search pattern, or does not " +
            "exist at all. 'error' (the default) reports the operation as failed, 'skip' leaves " +
            "the file untouched, and 'createIfMissing' creates a missing file containing only " +
            "the replacement text — an existing file without a match is left unchanged with a " +
            "warning.",
        }),
      patternNoMatch: z
        .enum(["error", "skip"])
        .default("skip")
        .meta({
          title: "Pattern without matches",
          description:
            "What happens when pathPattern selects no files at all. 'error' reports the " +
            "operation as failed, and 'skip' (the default) reports that there was nothing to " +
            "do. This setting is ignored when path is used instead of pathPattern.",
        }),
    })
    .superRefine((op, context) => {
      if ((op.path === null) === (op.pathPattern === null)) {
        context.addIssue({ code: "custom", message: "must give exactly one of 'path' or 'pathPattern'" });
      }
    })
    .meta({
      title: "Replace text in files",
      description:
        "Replace every match of find with replace in one exact file or in every file selected " +
        "by pathPattern. The search is literal text unless useRegex is true.",
    }),
});

const operationSchema = z.union([
  addSchema,
  addContentSchema,
  applyPatchSchema,
  deleteSchema,
  renameSchema,
  replaceSchema,
]);

export const definitionSchema = z.strictObject({
  writeMode: z
    .enum(["directCommit", "pullRequest"])
    .default("pullRequest")
    .meta({
      title: "How changes are written",
      description:
        "How the result is written to each repository. 'pullRequest' (the default) creates a " +
        "pull request that can be reviewed before merging, while 'directCommit' commits directly " +
        "to the target branch. A pull request needs the repository to allow it, and its details " +
        "come from the pullRequest section.",
    }),
  /**
   * Target branch: read from and committed to in `directCommit` mode, merged into in `pullRequest`
   * mode. Defaults to each repository's default branch when omitted.
   */
  branch: branchField
    .nullable()
    .default(null)
    .meta({
      title: "Target branch",
      description:
        "The repository branch the changes are based on. In directCommit mode the changes are " +
        "committed onto this branch; in pullRequest mode the pull request merges into it. " +
        "Omit this key to use each repository's own default branch, which is the usual choice " +
        "for bulk changes across many repositories.",
    }),
  commitMessage: z
    .string()
    .min(1, "must not be empty")
    .default("Apply bulk changes")
    .meta({
      title: "Commit message",
      description:
        "The message recorded on the commit written to each repository, for both write modes. " +
        "Keep it short and specific to the change, since it appears in each repository's " +
        "commit history. Defaults to 'Apply bulk changes' when omitted.",
    }),
  pullRequest: z
    .strictObject({
      branchName: branchField.default("bulk-changes").meta({
        title: "Pull request source branch",
        description:
          "The name of the new source branch that carries the changes for the pull request, " +
          "which Azure Repos merges into the target branch. It must not be an existing branch.",
      }),
      title: z
        .string()
        .min(1, "must not be empty")
        .default("Apply bulk changes")
        .meta({
          title: "Pull request title",
          description:
            "The title shown at the top of the created pull request. It must not be empty and " +
            "should name the change, since it also becomes the pull request's description in " +
            "Azure Repos lists. Defaults to 'Apply bulk changes' when omitted.",
        }),
      description: z
        .string()
        .default("")
        .meta({
          title: "Pull request description",
          description:
            "The longer description shown under the pull request title, explaining why the " +
            "change was made and how reviewers should read it. Empty by default.",
        }),
      draft: z
        .boolean()
        .default(false)
        .meta({
          title: "Create as a draft",
          description:
            "When true, the pull request is created as a draft that reviewers cannot approve " +
            "until it is marked ready by hand. A draft will also not run automatic CI checks. When false (the default), it is opened for " +
            "review immediately.",
        }),
      autoMerge: z
        .boolean()
        .default(false)
        .meta({
          title: "Auto-merge the pull request",
          description:
            "When true, the pull request is set to auto-merge: Azure Repos merges it as soon as " +
            "its merge conditions are met, without waiting for a reviewer. This bypasses review, " +
            "so use it deliberately. When false (the default), the pull request waits for a " +
            "reviewer to merge it. Using auto-merge is only recommended when there are mandatory CI checks in place.",
        }),
    })
    .default({
      branchName: "bulk-changes",
      title: "Apply bulk changes",
      description: "",
      draft: false,
      autoMerge: false,
    })
    .meta({
      title: "Pull request settings",
      description:
        "The settings of the pull request created when writeMode is 'pullRequest'. The section " +
        "is ignored in directCommit mode, where changes are committed straight to the target " +
        "branch.",
    }),
  operations: z
    .array(operationSchema)
    .min(1, "at least one operation is required")
    .meta({
      title: "File operations to apply",
      description:
        "The ordered list of operations applied to each selected repository, one entry per " +
        "operation. Each entry is an operation object keyed by its kind, such as 'add' or " +
        "'replace'. Later operations see the result of earlier ones, so order lets one " +
        "operation build on another. At least one operation is required.",
    }),
});

export const definitionJsonSchema = z.toJSONSchema(definitionSchema, { target: "draft-07", io: "input" });

export type RawDefinition = z.infer<typeof definitionSchema>;

export interface ParseSuccess {
  ok: true;
  definition: BulkChangeDefinition;
  /** The parsed raw document, for round-tripping or display. */
  raw: RawDefinition;
}

export interface ParseFailure {
  ok: false;
  /** Human-readable, one per issue, ordered by position in the document. */
  issues: string[];
  diagnostics: ParseDiagnostic[];
  /** How many `operations` entries the raw document had, so the editor can still count them. */
  operationCount: number;
}

export interface ParseDiagnostic {
  path: (string | number)[];
  code?: string;
  message: string;
  startOffset?: number;
  endOffset?: number;
}

export type ParseResult = ParseSuccess | ParseFailure;

function formatLocation(path: (string | number)[]): string {
  if (path.length === 0) {
    return "document";
  }
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") {
      return `${acc}[${segment}]`;
    }
    return acc ? `${acc}.${segment}` : segment;
  }, "");
}

function nodeAtPath(root: Node | null, path: (string | number)[]): Node | null {
  let current = root;
  for (const segment of path) {
    if (current instanceof YAMLSeq && typeof segment === "number") {
      const child = current.items[segment] as Node | undefined;
      if (!child) return current;
      current = child;
      continue;
    }
    if (current instanceof YAMLMap && typeof segment === "string") {
      const pair = current.items.find((item) => item.key instanceof Scalar && item.key.value === segment);
      if (!pair || pair.value === null) return current;
      current = pair.value as Node;
      continue;
    }
    return current;
  }
  return current;
}

function mapKeyNode(node: Node | null, key: string): Node | null {
  if (!(node instanceof YAMLMap)) return null;
  const pair = node.items.find((item) => item.key instanceof Scalar && item.key.value === key);
  return pair?.key instanceof Scalar ? pair.key : null;
}

function nodeOffsets(node: Node | null): Pick<ParseDiagnostic, "startOffset" | "endOffset"> {
  const range = node?.range;
  return range ? { startOffset: range[0], endOffset: range[1] } : {};
}

function diagnosticAtPath(
  root: Node | null,
  path: (string | number)[],
  code: string,
  message: string,
  node?: Node | null,
): ParseDiagnostic {
  return { path, code, message, ...nodeOffsets(node === undefined ? nodeAtPath(root, path) : node) };
}

function yamlParseDiagnostic(error: unknown): ParseDiagnostic {
  const yamlError = error instanceof YAMLParseError ? error : null;
  return {
    path: [],
    code: yamlError?.code ?? "yaml",
    message: `The document is not valid YAML: ${String(error)}`,
    ...(yamlError ? { startOffset: yamlError.pos[0], endOffset: yamlError.pos[1] } : {}),
  };
}

function diagnosticsForZodIssue(root: Node | null, issue: z.ZodIssue, message: string): ParseDiagnostic[] {
  const path = issue.path as (string | number)[];
  if (issue.code === "unrecognized_keys") {
    const parent = nodeAtPath(root, path);
    const keyDiagnostics = issue.keys.map((key) => {
      const keyName = String(key);
      return diagnosticAtPath(root, [...path, keyName], issue.code, message, mapKeyNode(parent, keyName));
    });
    if (keyDiagnostics.length > 0) return keyDiagnostics;
  }
  return [diagnosticAtPath(root, path, issue.code, message)];
}

function normalizeOperation(raw: RawOperationLike): BulkOperation {
  if ("add" in raw) {
    const op = raw.add;
    const operation: AddOperation = {
      kind: "add",
      path: tryNormalizeGitPath(op.path) as string,
      content: op.content,
      onlyIfMissing: op.onlyIfMissing,
    };
    return operation;
  }
  if ("addContent" in raw) {
    const op = raw.addContent;
    const operation: AddContentOperation = {
      kind: "addContent",
      path: op.path === null ? null : (tryNormalizeGitPath(op.path) as string),
      pathPattern: op.pathPattern === null ? null : (tryNormalizeGitPath(op.pathPattern) as string),
      content: op.content,
      position: op.position as ContentPosition,
      lineNumber: op.lineNumber,
      skipIfPresent: op.skipIfPresent,
      onFileMissing: op.onFileMissing as MissingFileBehavior,
      patternNoMatch: op.patternNoMatch as PatternMatchBehavior,
    };
    return operation;
  }
  if ("delete" in raw) {
    const op = raw.delete;
    const operation: DeleteOperation = {
      kind: "delete",
      path: op.path === null ? null : (tryNormalizeGitPath(op.path) as string),
      pathPattern: op.pathPattern === null ? null : (tryNormalizeGitPath(op.pathPattern) as string),
      recursive: op.recursive,
      onFileMissing: op.onFileMissing as MissingSourceBehavior,
      patternNoMatch: op.patternNoMatch as PatternMatchBehavior,
    };
    return operation;
  }
  if ("rename" in raw) {
    const op = raw.rename;
    const operation: RenameOperation = {
      kind: "rename",
      from: tryNormalizeGitPath(op.from) as string,
      to: tryNormalizeGitPath(op.to) as string,
      recursive: op.recursive,
      onFileMissing: op.onFileMissing as MissingSourceBehavior,
    };
    return operation;
  }
  if ("applyPatch" in raw) {
    const op = raw.applyPatch;
    const operation: ApplyPatchOperation = { kind: "applyPatch", patch: op.patch, allowPartial: op.allowPartial };
    return operation;
  }
  const op = raw.replace;
  const operation: ReplaceOperation = {
    kind: "replace",
    path: op.path === null ? null : (tryNormalizeGitPath(op.path) as string),
    pathPattern: op.pathPattern === null ? null : (tryNormalizeGitPath(op.pathPattern) as string),
    find: op.find,
    replace: op.replace,
    useRegex: op.useRegex,
    flags: op.flags,
    onNoMatch: op.onNoMatch as NoMatchBehavior,
    patternNoMatch: op.patternNoMatch as PatternMatchBehavior,
  };
  return operation;
}

type RawOperationLike = z.infer<typeof operationSchema>;

interface SemanticIssue {
  path: (string | number)[];
  message: string;
}

function extraSemanticIssues(raw: RawDefinition): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  const checkPattern = (value: string | null, path: (string | number)[]) => {
    if (value === null) {
      return;
    }
    try {
      compilePathPattern(value);
    } catch (err) {
      issues.push({
        path,
        message: `${formatLocation(path)} is not a valid pattern: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  raw.operations.forEach((operation, index) => {
    if ("addContent" in operation) {
      const op = operation.addContent;
      checkPattern(op.pathPattern, ["operations", index, "addContent", "pathPattern"]);
      if (op.position === "lineNumber" && op.lineNumber === null) {
        const path = ["operations", index, "addContent", "lineNumber"] as (string | number)[];
        issues.push({ path, message: `${formatLocation(path)} is required when position is lineNumber.` });
      }
      return;
    }
    if ("delete" in operation) {
      checkPattern(operation.delete.pathPattern, ["operations", index, "delete", "pathPattern"]);
      return;
    }
    if (!("replace" in operation)) {
      return;
    }
    const op = operation.replace;
    checkPattern(op.pathPattern, ["operations", index, "replace", "pathPattern"]);
    if (!op.useRegex) {
      return;
    }
    try {
      new RegExp(op.find, op.flags.includes("g") ? op.flags : `${op.flags}g`);
    } catch (err) {
      const path = ["operations", index, "replace", "find"] as (string | number)[];
      issues.push({ path, message: `${formatLocation(path)} is not a valid regular expression: ${String(err)}` });
    }
  });

  return issues;
}

/**
 * Parse a YAML change definition into the normalized domain model.
 *
 * Errors are collected as readable messages instead of thrown, so the editor can show them inline.
 */
export function parseDefinition(yamlText: string): ParseResult {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(yamlText, { prettyErrors: true });
  } catch (err) {
    const diagnostic = yamlParseDiagnostic(err);
    return { ok: false, operationCount: 0, issues: [diagnostic.message], diagnostics: [diagnostic] };
  }

  if (document.errors.length > 0) {
    const diagnostic = yamlParseDiagnostic(document.errors[0]);
    return { ok: false, operationCount: 0, issues: [diagnostic.message], diagnostics: [diagnostic] };
  }

  let parsed: unknown;
  try {
    parsed = document.toJS({ maxAliasCount: 100 });
  } catch (err) {
    const diagnostic = yamlParseDiagnostic(err);
    return { ok: false, operationCount: 0, issues: [diagnostic.message], diagnostics: [diagnostic] };
  }

  if (parsed === null || parsed === undefined) {
    const message = "The document is empty.";
    return { ok: false, operationCount: 0, issues: [message], diagnostics: [{ path: [], code: "empty", message }] };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    const message = "The document must be a mapping with an `operations` list.";
    const diagnostic = diagnosticAtPath(document.contents, [], "invalid_root", message);
    return { ok: false, operationCount: 0, issues: [message], diagnostics: [diagnostic] };
  }

  // Count the raw operations even when the document is invalid, so the editor can report "N operation(s)".
  const rawOperations = (parsed as { operations?: unknown }).operations;
  const operationCount = Array.isArray(rawOperations) ? rawOperations.length : 0;

  const result = definitionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const location = formatLocation(issue.path as (string | number)[]);
      const message = issue.message || "invalid value";
      return `${location}: ${message}`;
    });
    const diagnostics = result.error.issues.flatMap((issue, index) =>
      diagnosticsForZodIssue(document.contents, issue, issues[index]),
    );
    return { ok: false, operationCount, issues, diagnostics };
  }

  const semanticIssues = extraSemanticIssues(result.data);
  if (semanticIssues.length) {
    return {
      ok: false,
      operationCount,
      issues: semanticIssues.map((issue) => issue.message),
      diagnostics: semanticIssues.map((issue) =>
        diagnosticAtPath(document.contents, issue.path, "custom", issue.message),
      ),
    };
  }

  const raw = result.data;
  const definition: BulkChangeDefinition = {
    operations: raw.operations.map((operation) => normalizeOperation(operation)),
    writeMode: raw.writeMode,
    branch: raw.branch,
    commitMessage: raw.commitMessage,
    pullRequest: raw.pullRequest,
  };

  return { ok: true, definition, raw };
}
