# Git Bulk Changes

Perform the same change in many Git repositories at once, with a dry run you can review before anything is written.

Git Bulk Changes adds a page to the collection settings hub that lets you apply a change definition to every repository you select across the organization — projects and repositories are limited to what you already have access to.

## How it works

1. **Pick the scope.** Select the repositories to change from a single filterable list that spans every project you can access (each entry is labelled with its project). The list only contains repositories the signed-in user can read, so filtering matches across all of them at once.
2. **Describe the change once.** A definition is a small YAML document: an ordered list of operations plus how the result should be written (`writeMode`, `branchName`, `commitMessage`, `pullRequest`). It is edited in the same Monaco-based editor Azure Repos uses for file editing (following the host light/dark theme), and validated before anything runs. The **Examples** button opens a menu whose items replace the editor content with a ready-to-edit sample (add LICENSE where missing, rename a config file, update an agent pool, delete the .vs directory, add credits to the README); it is a one-shot action rather than a selected state, and you can append any additional operation of any kind to build a multi-step definition — the examples are starting points, not the only supported scenarios.
3. **Preview.** The preview is a read-only dry run. Each repository is read, the operations are applied in memory, and you get a per-repository status — _Would change_, _No change_, _Skipped_ or _Error_ — with the exact unified diff and a specific reason for anything skipped or failed. Diffs are computed locally and never sent to Azure DevOps.
4. **Apply.** Only after reviewing the preview can you write. Applying re-reads the branch tip, so a stale preview can never overwrite newer commits, and repositories are processed independently: one failure never stops the rest.

## Operations

| Operation    | Behaviour                                                                            |
| ------------ | ------------------------------------------------------------------------------------ |
| `add`        | Create a file; optionally only when it is missing.                                   |
| `addContent` | Insert text at the `start`, the `end` or a `lineNumber` of an existing file.         |
| `delete`     | Remove a file, or a whole directory with `recursive: true`; can ignore missing ones. |
| `rename`     | Rename or move a file (content is carried over).                                     |
| `replace`    | Change file content with a literal string or a regex.                                |

Paths are exact and case-sensitive, so a definition always says precisely which files it touches; listing a directory expands to the files inside it. A file that cannot be read as text (binary, too large) is skipped with a reason instead of being mangled.

## Write modes

The write mode is part of the YAML definition (`writeMode`), not a separate form:

- **Pull requests** (`writeMode: pullRequest`): a commit on a new source branch plus an open pull request per repository. Nothing is merged automatically.
- **Direct commit** (`writeMode: directCommit`, the default): commit straight onto the current branch tip. Requires Contribute permission on the branch, and the changes cannot be undone from this page. Requires Contribute permission on the branch, and the changes cannot be undone from this page.

## Permissions

All calls go directly to the Azure DevOps REST API with the signed-in user's OAuth token — there is no server component and no service principal. The extension requests only `vso.project` (list accessible projects), `vso.code` (read branches and files for the dry run) and `vso.code_write` (create the push and pull request when you press Apply). It never asks for a broader scope, so what it can do is bounded by your own permissions.

## Limitations

- Git repositories only; TFVC repositories and disabled repositories are not listed.
- Exact paths only — no glob or wildcard matching.
- Text files up to 1 MiB are processed; larger or binary files are skipped with a reason.
- Definitions are not persisted; they live in the page until you reload.
