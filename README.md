# Azure DevOps Git Bulk Changes

An Azure DevOps extension that lets project administrators perform bulk changes in Git repositories across an organization.

![Git Bulk Changes UI](images/screenshot_01.png)

## What it does

The extension adds a **Git Bulk Changes** page to the collection settings hub. Pick the repositories you
want to change (a single multi-select over every repository you can access, each labelled with its
project), describe the change once, and preview it across every selected repository before writing anything.

The preview is a read-only dry run: it reads each repository, applies the operations in memory and
shows a per-repository status (`Would change`, `No change`, `Skipped`, `Error`) together with the
exact unified diff and the reason for every skipped or failed repository. Only after you review the
preview can you apply the changes.

## Features

- **Multi-select repository scope.** You pick repositories directly from one filterable list that spans
  every project you can access (each entry shows its project), so filtering matches across all repositories
  at once. You only ever see repositories you have permissions for — the extension asks Azure DevOps for the
  caller's own accessible list and never enumerates the organization beyond that.
- **Declarative change definitions** written as YAML and validated with `zod` before anything runs.
  A definition is an ordered list of operations plus how to write the result. The definition is edited
  in a Monaco editor (the same editor Azure Repos uses for file editing) with YAML syntax highlighting,
  following the host's light or dark theme. The **Examples** button opens a menu that replaces the editor
  content with a ready-to-edit sample — it is a one-shot action, not a persistent selection.
- **Standard Azure DevOps components** (`Button`, `Dropdown`, `Table`, `Pill`, `MessageCard`, `MenuButton`,
  `Dialog`, …) from the [component library](https://developer.microsoft.com/en-us/azure-devops/components),
  so the hub keeps a polished look and adapts to either host theme.
- **Operations**: `add` (optionally only when missing), `delete`, `rename`/`move`, and `replace`
  (literal string or regular expression, with configurable `on_no_match` behaviour). Operations are
  appended one at a time, so a definition can grow to any number of steps — the templates are
  starting points you extend, not the only supported scenarios.
- **Exact, case-sensitive paths only** in v1 — no glob matching, so a definition says precisely which
  files it touches. A definition that lists a missing path surfaces as a per-repository skip or error
  instead of silently doing nothing.
- **Two write modes**, chosen in the YAML (`write_mode`): commit directly to a branch, or create a
  branch and open a pull request per repository.
- **Dry-run diffs computed locally**, never sent to the server.
- **Fail-isolated execution**: one repository failing never stops the others, and every failure is
  reported with a specific reason in the result row.

### Example definition

```yaml
name: Add LICENSE where missing
write_mode: pull_request
branch_name: add-license
commit_message: "Add MIT LICENSE file"
pull_request:
  title: "Add MIT LICENSE file"
  description: "Added by the Git Bulk Changes extension."
operations:
  - add:
      path: /LICENSE
      only_if_missing: true
      content: |
        MIT License
        ...
  - replace:
      path: /azure-pipelines.yml
      find: "pool: Azure"
      replace: 'pool: { name: "Self-Hosted", vmImages: AzureVMImage }'
      on_no_match: skip
```

Three ready-made templates are available in the editor — **Add LICENSE where missing**,
**Rename settings.json** and **Update agent pool in azure-pipelines.yml** — each of which you can
extend by adding more operations, or start from a blank definition and build your own.

## Getting started

1. Install the extension into your Azure DevOps organization.
2. Open the collection-level **Settings** hub and choose **Git Bulk Changes**.
3. Select the repositories to change.
4. Write (or pick) a change definition and press **Preview**.
5. Review the per-repository table and diffs, then press **Apply changes…** to commit or open pull
   requests.

Direct commits require Contribute permission on the target branch; pull-request mode only requires
read access plus the ability to create a pull request. Repositories you cannot access are simply not
listed, and repositories you can read but not write are reported as failures during apply.

## Permissions

All API calls are made directly from the browser using the signed-in user's OAuth token. There is no server-side component or service principal.

The extension requests these OAuth scopes:

| Scope            | Purpose                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vso.project`    | List the projects the caller can access and read project details, so the scope selector can show only repositories visible to the signed-in user. |
| `vso.code`       | Read repository metadata, default branches and file contents for the read-only dry run.                                                           |
| `vso.code_write` | Create the push (commit or branch) and, in pull-request mode, create the pull request. Only used when you press **Apply**.                        |

The extension deliberately does **not** request a broader scope such as `vso.full`: everything it can
do is bounded by the caller's own project and repository permissions.

## Development

### Local Development & Hot Reloading

For local development with hot-realoading, run `npm start` to launch the Webpack Dev Server and host the extension from `localhost:3000`.
To sideload the extension into Azure DevOps, you need to serve it over HTTPS. The easiest way to do this is with a self-signed development certificate.
You can create and trust a self-signed certificate with this command: `npm run create-dev-cert` (requires the .NET SDK to be installed).
This creates `dev.crt` and `dev.key` files in the project root, which are used by the `webpack.config.js` for HTTPS hosting.

To build an extension package for local development, run `npm run package:dev` which uses `vss-extension.dev.json` to override the manifest and point to the local development server

````sh

### Build

```sh
npm install
npm run build
````

### Run linter & tests

```sh
npm run lint
npm run test
```

### Package the extension

```sh
npm run package
```

This produces a `.vsix` file that can be uploaded to the Marketplace or installed directly into an Azure DevOps Server instance.

Note: The extension is packaged and published to the Visual Studio Marketplace automatically when a GitHub release is created.

### Development Resources

- [Azure DevOps Design System](https://developer.microsoft.com/en-us/azure-devops/)

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
