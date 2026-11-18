import { multilineSchema } from "./oxlint/multiline-schema.ts"
import { multilineSteps } from "./oxlint/multiline-steps.ts"
import { recommendedRules } from "./oxlint/recommended.ts"
import { staticActionDeclaration } from "./oxlint/static-action-declaration.ts"
import { stepNameStartsWithLowercase } from "./oxlint/step-name-starts-with-lowercase.ts"
import type { Plugin } from "@oxlint/plugins"

export const recommended = {
  jsPlugins: [{ name: "operandi", specifier: "operandi/oxlint" }],
  rules: { ...recommendedRules },
}

const plugin: Plugin & { configs: { recommended: typeof recommended } } = {
  meta: { name: "operandi" },
  rules: {
    "multiline-steps": multilineSteps,
    "multiline-schema": multilineSchema,
    "step-name-starts-with-lowercase": stepNameStartsWithLowercase,
    "static-action-declaration": staticActionDeclaration,
  },
  configs: { recommended },
}

export default plugin
