import { parseDocument, Document, Scalar, YAMLMap, YAMLSeq } from "yaml";
import { OperationKind } from "./types";

/**
 * A starter document for a brand-new definition. It is an empty scaffold on purpose: the schema requires
 * at least one operation, so it only validates once the user adds an operation.
 */
export const BLANK_DEFINITION = `writeMode: pullRequest # directCommit | pullRequest
commitMessage: "Apply bulk changes"
pullRequest:
  branchName: bulk-changes
  title: "Apply bulk changes"
  description: "Applied by the Git Bulk Changes extension."
  draft: false
  autoMerge: false
operations: []
`;

/** The operation template inserted for each kind, using the YAML keys. */
const TEMPLATES: Record<OperationKind, Record<string, unknown>> = {
  add: { add: { path: "/LICENSE", content: "file contents here", onlyIfMissing: true } },
  addContent: {
    addContent: {
      path: "/README.md",
      content: "text to add",
      position: "end",
      lineNumber: 1,
      skipIfPresent: true,
      onFileMissing: "skip",
    },
  },
  applyPatch: {
    applyPatch: {
      patch: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-old text",
        "+new text",
      ].join("\n"),
      allowPartial: false,
    },
  },
  delete: { delete: { path: "/obsolete.txt", recursive: false, onFileMissing: "skip" } },
  rename: { rename: { from: "/settings.json", to: "/config.json", onFileMissing: "skip" } },
  replace: {
    replace: {
      path: "/azure-pipelines.yml",
      find: "pool: Azure",
      replace: "pool: Self",
      useRegex: false,
      onNoMatch: "skip",
    },
  },
};

/** Same-line comments that clarify template fields and list allowed enum values. */
const FIELD_COMMENTS: Record<OperationKind, Record<string, string>> = {
  add: {},
  addContent: {
    position: "start | end | lineNumber",
    lineNumber: "1-based; only used when position is lineNumber",
    onFileMissing: "error | skip | createIfMissing",
  },
  applyPatch: {
    patch: "text Git unified diff; binary and file-mode-only patches are unsupported",
    allowPartial: "true | false; with true, files the patch cannot apply are skipped",
  },
  delete: { onFileMissing: "error | skip" },
  rename: { onFileMissing: "error | skip" },
  replace: { onNoMatch: "error | skip | createIfMissing" },
};

/** A short comment describing the step, kept above it so the YAML stays self-documenting. */
const COMMENTS: Record<OperationKind, string> = {
  add: "add a file",
  addContent: "add content to an existing file",
  applyPatch: "apply a Git patch; create with 'git show --format= --no-ext-diff --no-color --find-renames <commit>'",
  delete: "delete a file or directory",
  rename: "rename or move a file",
  replace: "change file content",
};

/**
 * Append an operation of the given kind to the `operations` list of a definition, preserving everything
 * else in the document (including existing comments where the YAML library keeps them).
 *
 * Returns the new YAML text, or `null` when the document cannot be parsed or has no usable `operations`
 * list. A definition without an `operations` key gets one created.
 */
export function appendOperation(yamlText: string, kind: OperationKind): string | null {
  let doc: Document.Parsed;
  try {
    doc = parseDocument(yamlText, { prettyErrors: true });
  } catch {
    return null;
  }
  // A document with parse errors cannot be stringified, so treat it as unusable.
  if (doc.errors.length > 0) {
    return null;
  }

  const contents = doc.contents;
  if (!(contents instanceof YAMLMap)) {
    return null;
  }
  // Relax the parsed generics: at runtime Collection.set/add accept plain nodes, but the parsed
  // node types would otherwise demand ParsedNode arguments here.
  const root = contents as unknown as YAMLMap<unknown, unknown>;

  const existing = root.get("operations");
  const seq = existing instanceof YAMLSeq ? (existing as unknown as YAMLSeq<unknown>) : new YAMLSeq();
  if (!(existing instanceof YAMLSeq)) {
    root.set("operations", seq);
  }
  seq.flow = false;

  const step = { ...TEMPLATES[kind] };
  const item = doc.createNode(step) as unknown as YAMLMap<unknown, unknown>;
  item.commentBefore = ` ${COMMENTS[kind]}`;
  const body = item.get(kind) as YAMLMap<unknown, unknown>;
  for (const [field, comment] of Object.entries(FIELD_COMMENTS[kind])) {
    const value = body.get(field, true) as Scalar | undefined;
    if (value) {
      value.comment = ` ${comment}`;
    }
  }
  seq.add(item);

  return doc.toString({ lineWidth: 0 });
}

export function countOperations(yamlText: string): number {
  try {
    const doc = parseDocument(yamlText);
    const seq = doc.get("operations");
    return seq instanceof YAMLSeq ? seq.items.length : 0;
  } catch {
    return 0;
  }
}
