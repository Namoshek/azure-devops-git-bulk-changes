import eslint from "@eslint/js";
import { fixupPluginRules } from "@eslint/compat";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Ignore build output and dependencies
  {
    ignores: ["dist/**", "node_modules/**", "jest.config.js", "webpack.config.js"],
  },

  // Base JavaScript recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules (includes parser setup)
  tseslint.configs.recommended,

  // React plugin (wrapped for ESLint 10 API compat)
  {
    plugins: {
      react: fixupPluginRules(reactPlugin),
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
    },
  },

  // Classic React Hooks rules only (v7 recommended includes React Compiler rules
  // which are not applicable to projects that don't use the React Compiler)
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Project-wide settings and overrides
  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React 17+ JSX transform — no need to import React in scope
      "react/react-in-jsx-scope": "off",
      // TypeScript already enforces types; prop-types is redundant
      "react/prop-types": "off",
      // Allow explicit `any` in test files and generated/complex types,
      // but warn in source to encourage proper typing
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused variables should be caught, but prefix with _ to suppress
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Relaxed rules for test files
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // require() is used intentionally in tests for jest module reloading
      // (e.g. require() after jest.mock() / jest.resetModules())
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
