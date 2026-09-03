import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "app/**",
      "chatgpt_gateway/**",
      "deploy/**",
      "tests/**",
      "src/tests/**",
      "src/routes/**",
      "src/services/ingestion/extractors/image.ts",
      "src/services/ingestion/extractors/pdf.ts"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "preserve-caught-error": "off",
      "require-yield": "off"
    },
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        URL: "readonly"
      }
    }
  }
);
