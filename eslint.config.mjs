import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent tooling state, including git worktrees that contain a full second
    // copy of this source tree. Without this, `npm run lint` reports every
    // file twice and drowns real findings in thousands of duplicates.
    ".claude/**",
  ]),
]);

export default eslintConfig;
