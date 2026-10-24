import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  BulkChangeDefinition,
  BulkOperation,
  DeleteOperation,
  NoMatchBehavior,
  MissingSourceBehavior,
  RenameOperation,
  ReplaceOperation,
  AddOperation,
} from "./types";
import { tryNormalizeGitPath } from "./pathUtils";

/** YAML keys use snake_case; the normalized domain model uses camelCase. */
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
    only_if_missing: z.boolean().default(false),
  }),
});

const deleteSchema = z.strictObject({
  delete: z.strictObject({
    path: pathField,
    on_missing: z.enum(["error", "skip"]).default("error"),
  }),
});

const renameSchema = z.strictObject({
  rename: z.strictObject({
    from: pathField,
    to: pathField,
    on_missing: z.enum(["error", "skip"]).default("error"),
  }),
});

const replaceSchema = z.strictObject({
  replace: z.strictObject({
    path: pathField,
    find: z.string().min(1, "must not be empty"),
    replace: z.string(),
    use_regex: z.boolean().default(false),
    flags: flagsField.default("m"),
    on_no_match: z.enum(["error", "skip", "create-if-missing"]).default("error"),
  }),
});

const operationSchema = z.union([addSchema, deleteSchema, renameSchema, replaceSchema]);

export const definitionSchema = z.strictObject({
  name: z.string().min(1, "must not be empty").max(120, "must be at most 120 characters"),
  description: z.string().default(""),
  write_mode: z.enum(["direct_commit", "pull_request"]).default("direct_commit"),
  /** Branch to commit to in `direct_commit` mode. Defaults to each repository's default branch. */
  branch: z.string().min(1).nullable().default(null),
  branch_name: z.string().min(1, "must not be empty").default("bulk-changes"),
  commit_message: z.string().min(1, "must not be empty").default("Apply bulk changes"),
  pull_request: z
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
      onlyIfMissing: op.only_if_missing,
    };
    return operation;
  }
  if ("delete" in raw) {
    const op = raw.delete;
    const operation: DeleteOperation = {
      kind: "delete",
      path: tryNormalizeGitPath(op.path) as string,
      onMissing: op.on_missing as MissingSourceBehavior,
    };
    return operation;
  }
  if ("rename" in raw) {
    const op = raw.rename;
    const operation: RenameOperation = {
      kind: "rename",
      from: tryNormalizeGitPath(op.from) as string,
      to: tryNormalizeGitPath(op.to) as string,
      onMissing: op.on_missing as MissingSourceBehavior,
    };
    return operation;
  }
  const op = raw.replace;
  const operation: ReplaceOperation = {
    kind: "replace",
    path: tryNormalizeGitPath(op.path) as string,
    find: op.find,
    replace: op.replace,
    useRegex: op.use_regex,
    flags: op.flags,
    onNoMatch: op.on_no_match as NoMatchBehavior,
  };
  return operation;
}

type RawOperationLike = z.infer<typeof operationSchema>;

function extraSemanticIssues(raw: RawDefinition): string[] {
  const issues: string[] = [];

  if (raw.write_mode === "pull_request" && raw.branch !== null) {
    issues.push(
      "`branch` can only be set together with `write_mode: direct_commit`; pull requests always target the default branch.",
    );
  }

  raw.operations.forEach((operation, index) => {
    if (!("replace" in operation)) {
      return;
    }
    const op = operation.replace;
    if (!op.use_regex) {
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
    writeMode: raw.write_mode === "pull_request" ? "pullRequest" : "directCommit",
    branch: raw.branch,
    branchName: raw.branch_name,
    commitMessage: raw.commit_message,
    pullRequestTitle: raw.pull_request.title,
    pullRequestDescription: raw.pull_request.description,
    pullRequestDraft: raw.pull_request.draft,
  };

  return { ok: true, definition, raw };
}
