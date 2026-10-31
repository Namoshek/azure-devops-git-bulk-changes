import React, { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import { definitionJsonSchema, ParseDiagnostic } from "../../../../domain/schema";
import { currentThemeName } from "../../../../utils/monacoTheme";
import "./YamlEditor.css";

const VALIDATION_MARKER_OWNER = "bulk-change-definition";
const EMPTY_DIAGNOSTICS: ParseDiagnostic[] = [];
const DEFINITION_MODEL_URI = "file:///bulk-changes/change-definition.yaml";

configureMonacoYaml(monaco, {
  completion: true,
  enableSchemaRequest: false,
  format: { enable: true },
  hover: true,
  hoverSchemaSource: false,
  schemas: [
    {
      uri: "inmemory://bulk-changes/change-definition.schema.json",
      fileMatch: [DEFINITION_MODEL_URI],
      schema: definitionJsonSchema,
    },
  ],
  validate: false,
});

/**
 * Monaco-based YAML editor, matching the editor Azure Repos uses for repository files.
 *
 * Webpack resolves `monaco-editor` through its published entry, which adapts the legacy worker
 * options used by monaco-yaml to Monaco's worker implementation.
 */
interface YamlEditorProps {
  value: string;
  language?: string;
  ariaLabel: string;
  disabled?: boolean;
  automaticLayout?: boolean;
  diagnostics?: ParseDiagnostic[];
  schemaAware?: boolean;
  onChange: (value: string) => void;
}

export function YamlEditor({
  value,
  language = "yaml",
  ariaLabel,
  disabled = false,
  automaticLayout = true,
  diagnostics = EMPTY_DIAGNOSTICS,
  schemaAware = false,
  onChange,
}: YamlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Latest callback without re-creating the editor model on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const initialTheme = currentThemeName();
    monaco.editor.setTheme(initialTheme);
    const model = monaco.editor.createModel(
      value,
      language,
      schemaAware ? monaco.Uri.parse(DEFINITION_MODEL_URI) : undefined,
    );
    const editor = monaco.editor.create(container, {
      model,
      theme: initialTheme,
      ariaLabel,
      automaticLayout,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      tabSize: 2,
      wordWrap: "off",
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    editorRef.current = editor;

    let layoutFrame: number | null = null;
    if (!automaticLayout) {
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        if (editorRef.current === editor) {
          editor.layout();
        }
      });
    }

    const changeSubscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    // updateOptions({ theme }) does not switch themes; monaco.editor.setTheme is the supported API.
    const onThemeChanged = (): void => {
      monaco.editor.setTheme(currentThemeName());
    };
    window.addEventListener("themeApplied", onThemeChanged);

    return () => {
      window.removeEventListener("themeApplied", onThemeChanged);
      const currentModel = editor.getModel();
      if (currentModel) {
        monaco.editor.setModelMarkers(currentModel, VALIDATION_MARKER_OWNER, []);
      }
      if (layoutFrame !== null) {
        cancelAnimationFrame(layoutFrame);
      }
      changeSubscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // Editor is created once; value updates are pushed imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external value changes (examples, add-operation) without clobbering what the user is typing.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;

    const modelLength = model.getValueLength();
    const markers: monaco.editor.IMarkerData[] = diagnostics.map((diagnostic) => {
      const startOffset = Math.min(Math.max(diagnostic.startOffset ?? 0, 0), modelLength);
      const endOffset = Math.min(Math.max(diagnostic.endOffset ?? startOffset, startOffset), modelLength);
      const markerEndOffset = endOffset > startOffset ? endOffset : Math.min(startOffset + 1, modelLength);
      const start = model.getPositionAt(startOffset);
      const end = model.getPositionAt(markerEndOffset);
      return {
        severity: monaco.MarkerSeverity.Error,
        message: diagnostic.message,
        code: diagnostic.code,
        source: "Definition",
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        modelVersionId: model.getVersionId(),
      };
    });
    monaco.editor.setModelMarkers(model, VALIDATION_MARKER_OWNER, markers);
  }, [diagnostics]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: disabled });
  }, [disabled]);

  return <div ref={containerRef} className="bc-monaco" aria-label={ariaLabel} role="textbox" />;
}
