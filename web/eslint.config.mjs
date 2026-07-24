import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  { ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Every image on this site is a small inline-friendly SVG (the brand mark
      // and the agent CLI logos), and the build is a static export with the
      // image optimizer disabled — `next/image` would add markup and a loader
      // for no gain here.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
