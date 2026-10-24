import React from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { IMenuProps } from "azure-devops-ui/Menu";
import { EXAMPLES } from "../../../../features/bulkChanges/examples";
import { OperationKind } from "../../../../features/bulkChanges/types";
import { ButtonGroupBase, MenuButtonBase } from "../../../../components/uiCompat";
import "./EditorActions.css";

const OPERATIONS: { kind: OperationKind; label: string }[] = [
  { kind: "add", label: "Add file" },
  { kind: "addContent", label: "Add content" },
  { kind: "applyPatch", label: "Apply Git patch" },
  { kind: "delete", label: "Delete" },
  { kind: "rename", label: "Rename / move" },
  { kind: "replace", label: "Replace content" },
];

const EXAMPLES_MENU: IMenuProps = {
  id: "bc-examples-menu",
  items: EXAMPLES.map((example) => ({ id: example.id, text: example.label })),
};

interface EditorActionsProps {
  disabled: boolean;
  onAddOperation: (kind: OperationKind) => void;
  onLoadExample: (id: string) => void;
}

/** Buttons that grow the definition (one operation at a time) or replace it with an example. */
export function EditorActions({ disabled, onAddOperation, onLoadExample }: EditorActionsProps) {
  return (
    <div className="bc-editor-actions">
      <ButtonGroupBase className="bc-editor-actions-operations">
        {OPERATIONS.map((operation) => (
          <Button
            key={operation.kind}
            text={operation.label}
            iconProps={{ iconName: "Add" }}
            onClick={() => onAddOperation(operation.kind)}
            disabled={disabled}
            ariaLabel={`Add operation: ${operation.label}`}
          />
        ))}
      </ButtonGroupBase>

      <MenuButtonBase
        text="Examples"
        ariaLabel="Load an example definition"
        disabled={disabled}
        contextualMenuProps={{ menuProps: EXAMPLES_MENU, onActivate: (item) => onLoadExample(item.id) }}
      />
    </div>
  );
}
