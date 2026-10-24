import React, { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

/**
 * Monaco-based YAML editor, matching the editor Azure Repos uses for repository files.
 *
 * `monaco-editor` is aliased in webpack to `editor.api.js`, so the monaco webpack plugin injects the
 * worker configuration and registers only the YAML language. The theme is derived from the Azure DevOps
 * palette variables the extension SDK applies, and refreshed when the host theme changes.
 */
interface YamlEditorProps {
  value: string;
  language?: string;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Normalize a CSS color to the `#rrggbb` form Monaco's themes require. Azure DevOps theme variables are
 * bare channel triplets such as `255, 255, 255` (consumed by the host as `rgba(var(--x), 1)`), so that
 * form is handled alongside `#hex` and `rgb()/rgba()`. Alpha is dropped; unconvertible values return null.
 */
function toHexColor(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const expanded = hex[1].length === 3 ? hex[1].replace(/(.)/g, "$1$1") : hex[1];
    return `#${expanded.toLowerCase()}`;
  }

  // Channel triplets: "255, 255, 255", "255 255 255", or inside rgb()/rgba(...) — take the first 3.
  const triplet = /([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(value);
  if (triplet) {
    const channel = (raw: string): number => {
      const n = raw.includes("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      return Math.max(0, Math.min(255, Math.round(n)));
    };
    const [r, g, b] = [channel(triplet[1]), channel(triplet[2]), channel(triplet[3])];
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  // Last resort: let the browser resolve named colors (e.g. "white") to an rgb() string.
  if (typeof document !== "undefined" && typeof CanvasRenderingContext2D !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = value;
      const resolved = typeof ctx.fillStyle === "string" ? ctx.fillStyle : "";
      if (resolved !== value) {
        return toHexColor(resolved);
      }
    }
  }

  return null;
}

function luminance(color: string): number {
  const hex = toHexColor(color);
  if (!hex) {
    return 1;
  }
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isDarkBackground(background: string): boolean {
  return luminance(background) < 0.5;
}

/**
 * The editor uses Monaco's built-in `vs` / `vs-dark` themes — the same color scheme as the Azure Repos
 * file editor. We deliberately do not define a custom theme: Monaco token colors are fixed by those
 * themes and cannot be derived from the Azure DevOps palette, so re-tinting them would drift away from
 * the built-in look. The light/dark choice follows the host background, and is refreshed when the host
 * theme changes.
 */
function currentThemeName(): string {
  const style = getComputedStyle(document.documentElement);
  // --background-color is the themed surface azure-devops-ui itself uses (see core.css .themed);
  // --palette-neutral-0 is the base palette tone and serves as a fallback.
  const background =
    toHexColor(style.getPropertyValue("--background-color")) ||
    toHexColor(style.getPropertyValue("--palette-neutral-0")) ||
    "#ffffff";
  return isDarkBackground(background) ? "vs-dark" : "vs";
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

    const onThemeChanged = (): void => {
      // updateOptions({ theme }) does not switch themes; monaco.editor.setTheme is the supported API.
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
