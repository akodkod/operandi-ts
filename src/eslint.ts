import oxlint from "./oxlint"
import { eslintCompatPlugin } from "@oxlint/plugins"
import type { ESLint } from "eslint"

// The adapter mutates rules, so keep the Oxlint entry point independent
const plugin = eslintCompatPlugin({
  ...oxlint,
  rules: Object.fromEntries(
    Object.entries(oxlint.rules).map(([name, rule]) => [name, { ...rule }]),
  ),
})

export default plugin as unknown as ESLint.Plugin
