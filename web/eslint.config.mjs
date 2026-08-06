import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Build output and Next's generated types are exempt from our rules.
  { ignores: ["out/**", ".next*/**", "node_modules/**", "next-env.d.ts"] },
];

export default eslintConfig;
