import React from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { MenuButton, IContextualMenuProps } from "azure-devops-ui/Menu";
import { ParseResult } from "../../features/bulkChanges/schema";
import { EXAMPLES } from "../../features/bulkChanges/examples";
import { OperationKind } from "../../features/bulkChanges/types";
import { YamlEditor } from "./YamlEditor";
import { asComponent } from "../../components/uiCompat";

/** See ScopeSelector: azure-devops-ui peers target React 16, so cast the component. */
const MenuButtonBase = asComponent(MenuButton);

interface DefinitionEditorProps {
  yamlText: string;
  parsed: ParseResult;
  disabled: boolean;
  onYamlChange: (yamlText: string) => void;
  onLoadExample: (id: string) => void;
  onAddOperation: (kind: OperationKind) => void;
}

const OPERATIONS: { kind: OperationKind; label: string }[] = [
  { kind: "add", label: "Add file" },
  { kind: "delete", label: "Delete file" },
  { kind: "rename", label: "Rename / move" },
  { kind: "replace", label: "Replace content" },
];

/**
 * The change-definition editor. The YAML document is the single source of truth: it decides both *what*
 * changes and *how* they are written. Examples seed a document, and the operation buttons append a ready-
 * to-edit step so a definition can grow to any number of operations, like adding steps to a pipeline job.
 */
export function DefinitionEditor({
  yamlText,
  parsed,
  disabled,
  onYamlChange,
  onLoadExample,
  onAddOperation,
}: DefinitionEditorProps) {
  const examplesMenuProps: IContextualMenuProps = {
    menuProps: {
      id: "bc-examples-menu",
      items: EXAMPLES.map((example) => ({ id: example.id, text: example.label })),
    },
    onActivate: (menuItem) => onLoadExample(menuItem.id),
  };

  return (
    <div className="bc-section">
      <div className="bc-section-title">Change definition</div>

      <YamlEditor value={yamlText} ariaLabel="Change definition YAML" disabled={disabled} onChange={onYamlChange} />

      <div className="bc-editor-actions rhythm-vertical-8">
        <div className="bc-button-row">
          <span className="bc-muted monospaced-s">Add operation</span>
          {OPERATIONS.map((operation) => (
            <Button
              key={operation.kind}
              subtle
              text={operation.label}
              iconProps={{ iconName: "Add" }}
              onClick={() => onAddOperation(operation.kind)}
              disabled={disabled}
              ariaLabel={`Add a ${operation.label.toLowerCase()} operation`}
            />
          ))}
        </div>

        <div className="bc-editor-actions-right">
          <MenuButtonBase
            text="Examples"
            ariaLabel="Load an example definition"
            disabled={disabled}
            contextualMenuProps={examplesMenuProps}
          />
        </div>
      </div>

      {parsed.ok ? (
        <div className="bc-muted monospaced-s rhythm-vertical-4">
          {parsed.definition.operations.length} operation(s) — valid.
        </div>
      ) : (
        <ul className="bc-issue-list" aria-label="Definition problems">
          {parsed.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
