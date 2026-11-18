// prettier-ignore
import { builderMethods, createBindings, importSourcesSchema, memberName, unwrap } from "./shared.ts"
import type { CreateOnceRule } from "@oxlint/plugins"

const methods = new Set([...builderMethods, "run", "runSafe"])

export const newlinePerChainedCall: CreateOnceRule = {
  meta: {
    type: "layout",
    docs: { description: "Require each chained Operandi call to start on a new line" },
    schema: importSourcesSchema,
    messages: { newline: "Start this Operandi .{{method}}() call on a new line." },
  },
  createOnce(context) {
    const { originatesFrom } = createBindings(context)

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)
        if (callee.type !== "MemberExpression") return

        const method = memberName(callee)
        if (!method || !methods.has(method)) return
        if (unwrap(callee.object).type !== "CallExpression") return
        if (!originatesFrom(callee.object, "builder")) return

        const access = context.sourceCode.getTokenBefore(callee.property)
        const previous = access && context.sourceCode.getTokenBefore(access)
        if (!access || !previous || access.loc.start.line > previous.loc.end.line) return

        context.report({ node: callee.property, messageId: "newline", data: { method } })
      },
    }
  },
}
