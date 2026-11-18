import oxlint from "./oxlint"
import { recommendedRules } from "./oxlint/recommended"
import { eslintCompatPlugin } from "@oxlint/plugins"
import type { ESLint, Linter } from "eslint"

// The adapter mutates rules, so keep the Oxlint entry point independent
const plugin = eslintCompatPlugin({
  ...oxlint,
  rules: Object.fromEntries(
    Object.entries(oxlint.rules).map(([name, rule]) => [name, { ...rule }]),
  ),
}) as unknown as ESLint.Plugin

export const recommended: Linter.Config & { rules: typeof recommendedRules } = {
  name: "operandi/recommended",
  plugins: { operandi: plugin },
  rules: { ...recommendedRules },
}

const configuredPlugin: ESLint.Plugin & { configs: { recommended: typeof recommended } } =
  Object.assign(plugin, { configs: { recommended } })

export default configuredPlugin
