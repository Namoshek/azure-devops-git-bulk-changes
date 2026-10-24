import addLicense from "./examples/add-license.yml";
import addReadmeCredits from "./examples/add-readme-credits.yml";
import deleteVsDirectory from "./examples/delete-vs-directory.yml";
import renameConfig from "./examples/rename-config.yml";
import updateAgentPool from "./examples/update-agent-pool.yml";
import { parseDefinition, ParseResult } from "./schema";

export interface DefinitionExample {
  /** Stable id used for the preset buttons. */
  id: string;
  label: string;
  /** The raw YAML document, ready to load into the editor. */
  yaml: string;
}

/**
 * Built-in change definitions. The YAML files are bundled as strings by webpack
 * (`asset/source` for `.yml`), so they stay readable and editable.
 */
export const EXAMPLES: DefinitionExample[] = [
  { id: "add-license", label: "Add LICENSE where missing", yaml: addLicense },
  { id: "rename-config", label: "Rename settings.json", yaml: renameConfig },
  { id: "update-agent-pool", label: "Update agent pool in azure-pipelines.yml", yaml: updateAgentPool },
  { id: "delete-vs-directory", label: "Delete .vs directory", yaml: deleteVsDirectory },
  { id: "add-readme-credits", label: "Add credits to README.md", yaml: addReadmeCredits },
];

export function findExample(id: string): DefinitionExample | undefined {
  return EXAMPLES.find((example) => example.id === id);
}

/** Parse an example, throwing away the type so callers can treat it like any other document. */
export function parseExample(id: string): ParseResult {
  const example = findExample(id);
  if (!example) {
    return { ok: false, issues: [`Unknown example "${id}".`] };
  }
  return parseDefinition(example.yaml);
}
