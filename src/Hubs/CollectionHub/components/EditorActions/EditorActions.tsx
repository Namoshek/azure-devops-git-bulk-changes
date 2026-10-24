import React from "react";
import { Button } from "azure-devops-ui/Components/Button/Button";
import { IMenuProps } from "azure-devops-ui/Menu";
import { EXAMPLES } from "../../../../domain/bulkChanges/examples";
import { OperationKind } from "../../../../domain/bulkChanges/types";
import { ButtonGroupBase, MenuButtonBase } from "../../../../components/uiCompat";
import "./EditorActions.css";

const OPERATIONS: { kind: OperationKind; label: string; iconName: string }[] = [
  { kind: "add", label: "Add file", iconName: "PageAdd" },
  { kind: "addContent", label: "Add content", iconName: "TextField" },
  { kind: "applyPatch", label: "Apply Git patch", iconName: "BranchCompare" },
  { kind: "delete", label: "Delete", iconName: "Delete" },
  { kind: "rename", label: "Rename / move", iconName: "Rename" },
  { kind: "replace", label: "Replace content", iconName: "Edit" },
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
            iconProps={{ iconName: operation.iconName }}
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
