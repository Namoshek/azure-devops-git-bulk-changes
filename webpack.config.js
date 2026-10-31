const fs = require("fs");
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");

const certPath = path.resolve(__dirname, "dev.crt");
const keyPath = path.resolve(__dirname, "dev.key");
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

module.exports = {
  entry: {
    CollectionHub: "./src/Hubs/CollectionHub/index.tsx",
  },
  output: {
    filename: "[name]/[name].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "/dist/",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    alias: {
      // Pin to a single entry point so the ESM import path and the AMD require
      // path used by azure-devops-extension-api both resolve to the same module
      // instance, preventing the "SDK is already loaded" duplicate-detection error.
      "azure-devops-extension-sdk": path.resolve(__dirname, "node_modules/azure-devops-extension-sdk/SDK.js"),
      // Use Monaco's published entry so monaco-yaml's legacy worker manager receives its worker API
      // compatibility wrapper; the webpack plugin injects the worker configuration below.
      "monaco-editor$": path.resolve(__dirname, "node_modules/monaco-editor/esm/vs/editor/editor.main.js"),
      "monaco-editor/esm/vs/editor/editor.worker.js$": path.resolve(
        __dirname,
        "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
      ),
    },
  },
  module: {
    parser: {
      javascript: {
        dynamicImportMode: "eager",
      },
    },
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/,
        type: "asset/inline",
      },
      {
        test: /\.ya?ml$/,
        type: "asset/source",
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: "src/Hubs/CollectionHub/index.html", to: "CollectionHub/index.html" }],
    }),
    // Emit the monaco editor worker and register only the YAML language, mirroring the editor Azure
    // Repos uses for file editing. monaco-yaml adds the schema-language worker.
    new MonacoWebpackPlugin({
      languages: ["yaml"],
      customLanguages: [
        {
          label: "yaml",
          entry: "monaco-yaml",
          worker: {
            id: "monaco-yaml/yamlWorker",
            entry: "monaco-yaml/yaml.worker",
          },
        },
      ],
      filename: "[name].worker.js",
    }),
  ],
  performance: {
    hints: false,
  },
  devServer: {
    port: 3000,
    server: hasCerts
      ? {
          type: "https",
          options: {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          },
        }
      : "http",
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
};
