import React from "react";
import { FileDiff } from "../../features/bulkChanges/types";

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
  const lines = diff.diff.split("\n");
  const pathLabel = diff.originalPath ? `${diff.originalPath} → ${diff.path}` : diff.path;

  return (
    <div className="rhythm-vertical-8">
      <div className="bc-diff-path text-ellipsis">
        {pathLabel}
        <span className="bc-muted monospaced-s">
          {" "}
          +{diff.additions} / -{diff.deletions}
        </span>
      </div>
      <pre className="bc-diff" aria-label={`Diff for ${pathLabel}`}>
        {lines.map((line, index) => (
          <span key={index} className={lineClass(line)}>
            {line === "" ? " " : line}
          </span>
        ))}
      </pre>
    </div>
  );
}
