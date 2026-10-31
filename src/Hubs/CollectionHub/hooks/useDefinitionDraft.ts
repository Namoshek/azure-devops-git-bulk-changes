import { useCallback, useMemo, useState } from "react";
import { appendOperation } from "../../../domain/definitionOps";
import { EXAMPLES, findExample } from "../../../domain/examples";
import { ParseResult, parseDefinition } from "../../../domain/schema";
import { BulkChangeDefinition, OperationKind } from "../../../domain/types";

export interface DefinitionDraft {
  yamlText: string;
  parsed: ParseResult;
  /** The parsed definition, or `null` while the YAML is invalid; only a valid one can drive a run. */
  definition: BulkChangeDefinition | null;
  setYamlText: (yamlText: string) => void;
  loadExample: (id: string) => void;
  addOperation: (kind: OperationKind) => void;
}

/** Owns the YAML text of the change definition and everything derived from it. */
export function useDefinitionDraft(): DefinitionDraft {
  const [yamlText, setYamlText] = useState(EXAMPLES[0].yaml);

  const parsed = useMemo(() => parseDefinition(yamlText), [yamlText]);
  const definition = parsed.ok ? parsed.definition : null;

  // The menu is a one-shot action: any later edit makes the document the user's own.
  const loadExample = useCallback((id: string): void => {
    const example = findExample(id);
    if (example) {
      setYamlText(example.yaml);
    }
  }, []);

  const addOperation = useCallback((kind: OperationKind): void => {
    setYamlText((previous) => appendOperation(previous, kind) ?? previous);
  }, []);

  return { yamlText, parsed, definition, setYamlText, loadExample, addOperation };
}
