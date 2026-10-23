# Azure DevOps Git Bulk Changes

An Azure DevOps extension that lets project administrators perform bulk changes in Git repositories across an organization.

![Git Bulk Changes UI](images/screenshot_template_selection.png)

## What it does

TBD

## Features

TBD

## Getting started

TBD

## Permissions

All API calls are made directly from the browser using the signed-in user's OAuth token. There is no server-side component or service principal.

The extension requests these OAuth scopes:

| Scope | Purpose |
| ----- | ------- |
|       |         |

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
