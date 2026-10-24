import { parseDocument, Document, YAMLMap, YAMLSeq } from "yaml";
import { OperationKind } from "./types";

/**
 * A starter document for a brand-new definition. It is an empty scaffold on purpose: the schema requires
 * at least one operation, so it only validates once the user adds an operation.
 */
export const BLANK_DEFINITION = `name: My bulk change
description: Describe what this definition does.
write_mode: pull_request
branch_name: bulk-changes
commit_message: "Apply bulk changes"
pull_request:
  title: "Apply bulk changes"
  description: "Applied by the Git Bulk Changes extension."
  draft: false
operations: []
`;

/** The operation template inserted for each kind, using the YAML (snake_case) keys. */
const TEMPLATES: Record<OperationKind, Record<string, unknown>> = {
  add: { add: { path: "/LICENSE", content: "file contents here", only_if_missing: true } },
  delete: { delete: { path: "/obsolete.txt", on_missing: "skip" } },
  rename: { rename: { from: "/settings.json", to: "/config.json", on_missing: "skip" } },
  replace: {
    replace: {
      path: "/azure-pipelines.yml",
      find: "pool: Azure",
      replace: "pool: Self",
      use_regex: false,
      on_no_match: "skip",
    },
  },
};

/** A short comment describing the step, kept above it so the YAML stays self-documenting. */
const COMMENTS: Record<OperationKind, string> = {
  add: "add a file",
  delete: "delete a file",
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

  const step = { ...TEMPLATES[kind] };
  const item = doc.createNode(step);
  item.commentBefore = ` ${COMMENTS[kind]}`;
  seq.add(item);

  return doc.toString({ lineWidth: 0 });
}

/** Count the operations currently in a definition, without full validation. Used for the UI only. */
export function countOperations(yamlText: string): number {
  try {
    const doc = parseDocument(yamlText);
    const seq = doc.get("operations");
    return seq instanceof YAMLSeq ? seq.items.length : 0;
  } catch {
    return 0;
  }
}
