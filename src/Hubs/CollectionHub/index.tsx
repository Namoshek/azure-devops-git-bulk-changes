import React from "react";
import { createRoot } from "react-dom/client";
import * as SDK from "azure-devops-extension-sdk";
import { CollectionApp } from "./CollectionApp";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import "azure-devops-ui/Core/override.css";

declare let __webpack_public_path__: string;
// Webpack requires assignment to its runtime public-path variable.
// eslint-disable-next-line prefer-const
__webpack_public_path__ = new URL("../", window.location.href).href;

SDK.init().then(() => {
  const container = document.getElementById("root");
  if (container) {
    createRoot(container).render(
      <ErrorBoundary>
        <CollectionApp />
      </ErrorBoundary>,
    );
  }
});
