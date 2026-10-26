import React from "react";
import { FileDiff } from "../../../../domain/types";
import "./DiffView.css";

function lineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bc-diff-line bc-diff-added";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bc-diff-line bc-diff-removed";
  }
  if (
    line.startsWith("@@") ||
    line.startsWith("diff --git") ||
    line.startsWith("rename ") ||
    line.startsWith("index ")
  ) {
    return "bc-diff-line bc-diff-hunk";
  }
  return "bc-diff-line";
}

/** One file's unified diff, rendered as plain text lines with add/remove colouring. */
export function DiffView({ diff }: { diff: FileDiff }) {
  const pathLabel = diff.originalPath ? `${diff.originalPath} → ${diff.path}` : diff.path;

  return (
    <div className="bc-diff-view">
      <div className="bc-diff-path text-ellipsis">
        {pathLabel}{" "}
        <span className="monospaced-s">
          <span className="bc-diff-additions">+{diff.additions}</span>
          <span className="bc-diff-separator"> / </span>
          <span className="bc-diff-deletions">-{diff.deletions}</span>
        </span>
      </div>
      <pre className="bc-diff custom-scrollbar" aria-label={`Diff for ${pathLabel}`}>
        {diff.diff.split("\n").map((line, index) => (
          <span key={index} className={lineClass(line)}>
            {line === "" ? " " : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
