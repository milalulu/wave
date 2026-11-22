import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "node_modules.linux-backup/**", "src-tauri/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  { files: ["**/*.mjs"], languageOptions: { globals: {
    AbortController: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
    fetch: "readonly", console: "readonly", process: "readonly",
  } } },
  { files: ["tests/**/*.mjs"], languageOptions: { globals: {
    document: "readonly", window: "readonly", innerWidth: "readonly", innerHeight: "readonly",
    getComputedStyle: "readonly", URL: "readonly",
  } } },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
