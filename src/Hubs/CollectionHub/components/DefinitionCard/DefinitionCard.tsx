import React from "react";
import { TitleSize } from "azure-devops-ui/Components/Header/Header.Props";
import { ParseResult } from "../../../../features/bulkChanges/schema";
import { OperationKind } from "../../../../features/bulkChanges/types";
import { CardBase } from "../../../../components/uiCompat";
import { CardBody } from "../../../../components/CardBody/CardBody";
import { EditorActions } from "../EditorActions/EditorActions";
import { ValidationMessage } from "../ValidationMessage/ValidationMessage";
import { YamlEditor } from "../YamlEditor/YamlEditor";

interface DefinitionCardProps {
  yamlText: string;
  parsed: ParseResult;
  /** True while a run is in flight; the definition must not change underneath it. */
  disabled: boolean;
  onYamlChange: (yamlText: string) => void;
  onLoadExample: (id: string) => void;
  onAddOperation: (kind: OperationKind) => void;
}

/**
 * The change-definition editor. The YAML document is the single source of truth for both what changes
 * and how it is written.
 */
export function DefinitionCard({
  yamlText,
  parsed,
  disabled,
  onYamlChange,
  onLoadExample,
  onAddOperation,
}: DefinitionCardProps) {
  return (
    <CardBase titleProps={{ text: "Change definition", size: TitleSize.Medium }}>
      <CardBody>
        <YamlEditor value={yamlText} ariaLabel="Change definition YAML" disabled={disabled} onChange={onYamlChange} />
        <EditorActions disabled={disabled} onAddOperation={onAddOperation} onLoadExample={onLoadExample} />
        <ValidationMessage parsed={parsed} />
      </CardBody>
    </CardBase>
  );
}
