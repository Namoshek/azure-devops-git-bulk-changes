# Git Bulk Changes

Allows users to perform the same change in many Git repositories at once, with a dry run that needs to be reviewed before anything is written.

The extension adds a page to the collection settings that lets any user of the organization apply a change definition to every repository they select. The projects and repositories are limited to what the user already has access to.

## How it works

1. **Pick the scope.** Select the repositories to change from a single filterable list that spans every project you can access (each entry is labelled with its project). The list only contains repositories the signed-in user can read, so filtering matches across all of them at once.
2. **Describe the change once.** A definition is a small YAML document: an ordered list of operations plus how the result should be written (`writeMode`, `commitMessage`, and `pullRequest`).
3. **Preview.** The preview is a read-only dry run. Each repository is read, the operations are applied in memory, and you get a per-repository status with the exact unified diff and a specific reason for anything skipped or failed. Diffs are computed locally and never sent to Azure DevOps.
4. **Apply.** Only after reviewing the preview and accepting the changes, they are written to the repositories. If any repository cannot be updated, it is skipped with a reason, and the rest continue independently.

### Operations

| Operation    | Behaviour                                                                            |
| ------------ | ------------------------------------------------------------------------------------ |
| `add`        | Create a file; optionally only when it is missing.                                   |
| `addContent` | Insert text at the `start`, the `end` or a `lineNumber` of an existing file.         |
| `applyPatch` | Apply a unified Git patch across one or more text files.                             |
| `delete`     | Remove a file, or a whole directory with `recursive: true`; can ignore missing ones. |
| `rename`     | Rename or move a file (content is carried over).                                     |
| `replace`    | Replace literal text by default. With `useRegex: true`, `find` is a JavaScript regex, `$1` or `$<name>` in `replace` reference capture groups, and all matches are replaced (`g` is added automatically). |

Paths are exact and case-sensitive, so a definition always says precisely which files it touches; listing a directory expands to the files inside it. Patch paths are read from their headers and must stay inside the repository. Binary patches, file-mode changes, and hunks that do not match the current file content are rejected. A file that cannot be read as text (binary, too large) is skipped with a reason instead of being mangled.

### Write modes

The `writeMode` defines how the changes will be applied to the repositories:

- **Pull requests** (`writeMode: pullRequest`): a commit on a new source branch plus an open pull request per repository. Set `pullRequest.autoMerge: true` to enable Azure DevOps auto-complete; it merges only after the pull request's configured requirements pass.
- **Direct commit** (`writeMode: directCommit`, the default): commit straight onto the current branch tip. Requires Contribute permission on the branch, and the changes cannot be undone from this page. Requires Contribute permission on the branch, and the changes cannot be undone from this page.

### Example definition

```yaml
writeMode: pullRequest # directCommit | pullRequest
commitMessage: "Add MIT LICENSE file"
pullRequest:
  branchName: add-license
  title: "Add MIT LICENSE file"
  description: "Added by the Git Bulk Changes extension."
  draft: false
  autoMerge: false
operations:
  # add a file
  - add:
      path: /LICENSE
      onlyIfMissing: true
      content: |
        MIT License
        ...
  # change file content
  - replace:
      path: /azure-pipelines.yml
      find: "pool: Azure"
      replace: 'pool: { name: "Self-Hosted", vmImages: AzureVMImage }'
      onNoMatch: skip # error | skip | createIfMissing
```

The extension provides a few example definitions as a starting point. Adding additional operations is straightforward and can be done by using the buttons below the editor.

## Getting started

### 1. Install the extension

Install [**Git Bulk Changes** from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=namoshek.ado-git-bulk-changes) into your Azure DevOps organization.

### 2. Perform your first bulk change

To perform your first bulk change, follow these steps:

- Open the collection settings from the project overview.
- Choose **Git Bulk Changes** from the settings menu (section "Extensions").
- Fill out the form, preview the changes, and apply them to the selected repositories.

## Permissions

The extension requests the following OAuth scopes on behalf of the signed-in user:

| Scope            | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `vso.code`       | Required to read repositories and their contents                             |
| `vso.code_write` | Required to write changes to repositories (create commits and pull requests) |
| `vso.project`    | Required to read accessible projects (required for listing repositories)     |

All calls go directly to the Azure DevOps REST API with the signed-in user's OAuth token. There is no server component and no service principal. Since the extension only lives in an iframe in the browser, it cannot perform any actions beyond what the signed-in user is permitted to do and it will never leak any data to a third party.

## Limitations

- Git repositories only; TFVC repositories (and disabled repositories) are not supported.
- Currently, only exact paths are supported (no glob or wildcard matching).
- Text files up to 1 MiB are processed; larger or binary files are skipped to prevent performance issues.

## Screenshots

![Preview](https://raw.githubusercontent.com/Namoshek/azure-devops-git-bulk-changes/refs/heads/main/images/screenshot_01.png)

![Apply Confirmation](https://raw.githubusercontent.com/Namoshek/azure-devops-git-bulk-changes/refs/heads/main/images/screenshot_02.png)

![History](https://raw.githubusercontent.com/Namoshek/azure-devops-git-bulk-changes/refs/heads/main/images/screenshot_03.png)
