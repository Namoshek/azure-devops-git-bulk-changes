import React, { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { currentThemeName } from "../../../../utils/monacoTheme";
import "./YamlEditor.css";

/**
 * Monaco-based YAML editor, matching the editor Azure Repos uses for repository files.
 *
 * `monaco-editor` is aliased in webpack to `editor.api.js`, so the monaco webpack plugin injects the
 * worker configuration and registers only the YAML language.
 */
interface YamlEditorProps {
  value: string;
  language?: string;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function YamlEditor({ value, language = "yaml", ariaLabel, disabled = false, onChange }: YamlEditorProps) {
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
    const editor = monaco.editor.create(container, {
      value,
      language,
      theme: initialTheme,
      ariaLabel,
      automaticLayout: true,
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
      changeSubscription.dispose();
      editor.dispose();
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
    editorRef.current?.updateOptions({ readOnly: disabled });
  }, [disabled]);

  return <div ref={containerRef} className="bc-monaco" aria-label={ariaLabel} role="textbox" />;
}
