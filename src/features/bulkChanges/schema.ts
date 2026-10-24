import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  AddContentOperation,
  AddOperation,
  BulkChangeDefinition,
  BulkOperation,
  ContentPosition,
  DeleteOperation,
  MissingFileBehavior,
  MissingSourceBehavior,
  NoMatchBehavior,
  RenameOperation,
  ReplaceOperation,
} from "./types";
import { tryNormalizeGitPath } from "./pathUtils";

const VALID_FLAGS = /^[igmusvy]*$/;

const pathField = z
  .string()
  .min(1, "must be a non-empty path")
  .refine((value) => tryNormalizeGitPath(value) !== null, "must be a repository-root-relative path without '..'");

const flagsField = z.string().refine((value) => VALID_FLAGS.test(value), "may only contain the flags i, m, s, u, v, y");

const addSchema = z.strictObject({
  add: z.strictObject({
    path: pathField,
    content: z.string(),
    onlyIfMissing: z.boolean().default(false),
  }),
});

const addContentSchema = z.strictObject({
  addContent: z.strictObject({
    path: pathField,
    content: z.string(),
    position: z.enum(["start", "end", "lineNumber"]).default("end"),
    lineNumber: z.number().int().min(1, "must be 1 or greater").nullable().default(null),
    skipIfPresent: z.boolean().default(true),
    onMissing: z.enum(["error", "skip", "createIfMissing"]).default("error"),
  }),
});

const deleteSchema = z.strictObject({
  delete: z.strictObject({
    path: pathField,
    recursive: z.boolean().default(false),
    onMissing: z.enum(["error", "skip"]).default("error"),
  }),
});

const renameSchema = z.strictObject({
  rename: z.strictObject({
    from: pathField,
    to: pathField,
    onMissing: z.enum(["error", "skip"]).default("error"),
  }),
});

const replaceSchema = z.strictObject({
  replace: z.strictObject({
    path: pathField,
    find: z.string().min(1, "must not be empty"),
    replace: z.string(),
    useRegex: z.boolean().default(false),
    flags: flagsField.default("m"),
    onNoMatch: z.enum(["error", "skip", "createIfMissing"]).default("error"),
  }),
});

const operationSchema = z.union([addSchema, addContentSchema, deleteSchema, renameSchema, replaceSchema]);

export const definitionSchema = z.strictObject({
  name: z.string().min(1, "must not be empty").max(120, "must be at most 120 characters"),
  description: z.string().default(""),
  writeMode: z.enum(["directCommit", "pullRequest"]).default("directCommit"),
  /** Branch to commit to in `directCommit` mode. Defaults to each repository's default branch. */
  branch: z.string().min(1).nullable().default(null),
  branchName: z.string().min(1, "must not be empty").default("bulk-changes"),
  commitMessage: z.string().min(1, "must not be empty").default("Apply bulk changes"),
  pullRequest: z
    .strictObject({
      title: z.string().min(1, "must not be empty").default("Apply bulk changes"),
      description: z.string().default(""),
      draft: z.boolean().default(false),
    })
    .default({ title: "Apply bulk changes", description: "", draft: false }),
  operations: z.array(operationSchema).min(1, "at least one operation is required"),
});

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
      path: tryNormalizeGitPath(op.path) as string,
      content: op.content,
      position: op.position as ContentPosition,
      lineNumber: op.lineNumber,
      skipIfPresent: op.skipIfPresent,
      onMissing: op.onMissing as MissingFileBehavior,
    };
    return operation;
  }
  if ("delete" in raw) {
    const op = raw.delete;
    const operation: DeleteOperation = {
      kind: "delete",
      path: tryNormalizeGitPath(op.path) as string,
      recursive: op.recursive,
      onMissing: op.onMissing as MissingSourceBehavior,
    };
    return operation;
  }
  if ("rename" in raw) {
    const op = raw.rename;
    const operation: RenameOperation = {
      kind: "rename",
      from: tryNormalizeGitPath(op.from) as string,
      to: tryNormalizeGitPath(op.to) as string,
      onMissing: op.onMissing as MissingSourceBehavior,
    };
    return operation;
  }
  const op = raw.replace;
  const operation: ReplaceOperation = {
    kind: "replace",
    path: tryNormalizeGitPath(op.path) as string,
    find: op.find,
    replace: op.replace,
    useRegex: op.useRegex,
    flags: op.flags,
    onNoMatch: op.onNoMatch as NoMatchBehavior,
  };
  return operation;
}

type RawOperationLike = z.infer<typeof operationSchema>;

function extraSemanticIssues(raw: RawDefinition): string[] {
  const issues: string[] = [];

  if (raw.writeMode === "pullRequest" && raw.branch !== null) {
    issues.push(
      "`branch` can only be set together with `writeMode: directCommit`; pull requests always target the default branch.",
    );
  }

  raw.operations.forEach((operation, index) => {
    if ("addContent" in operation) {
      const op = operation.addContent;
      if (op.position === "lineNumber" && op.lineNumber === null) {
        issues.push(`operations[${index}].addContent.lineNumber is required when position is lineNumber.`);
      }
      return;
    }
    if (!("replace" in operation)) {
      return;
    }
    const op = operation.replace;
    if (!op.useRegex) {
      return;
    }
    try {
      new RegExp(op.find, op.flags.includes("g") ? op.flags : `${op.flags}g`);
    } catch (err) {
      issues.push(`operations[${index}].replace.find is not a valid regular expression: ${String(err)}`);
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
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText, { maxAliasCount: 100 });
  } catch (err) {
    return { ok: false, issues: [`The document is not valid YAML: ${String(err)}`] };
  }

  if (parsed === null || parsed === undefined) {
    return { ok: false, issues: ["The document is empty."] };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, issues: ["The document must be a mapping with a `name` and an `operations` list."] };
  }

  const result = definitionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const location = formatLocation(issue.path as (string | number)[]);
      const message = issue.message || "invalid value";
      return `${location}: ${message}`;
    });
    return { ok: false, issues };
  }

  const semanticIssues = extraSemanticIssues(result.data);
  if (semanticIssues.length) {
    return { ok: false, issues: semanticIssues };
  }

  const raw = result.data;
  const definition: BulkChangeDefinition = {
    operations: raw.operations.map((operation) => normalizeOperation(operation)),
    writeMode: raw.writeMode,
    branch: raw.branch,
    branchName: raw.branchName,
    commitMessage: raw.commitMessage,
    pullRequestTitle: raw.pullRequest.title,
    pullRequestDescription: raw.pullRequest.description,
    pullRequestDraft: raw.pullRequest.draft,
  };

  return { ok: true, definition, raw };
}
