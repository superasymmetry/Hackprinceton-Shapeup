import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [".venv/**", "**/.venv/**"],
  },
];

export default eslintConfig;
