import {
  createBindings,
  importSourcesSchema,
  memberName,
  multilineMethods,
  unwrap,
} from "./shared.ts"
import type { CreateOnceRule } from "@oxlint/plugins"

export const multilineSteps: CreateOnceRule = {
  meta: {
    type: "layout",
    docs: { description: "Require Operandi step and lifecycle hook calls to span multiple lines" },
    schema: importSourcesSchema,
    messages: { multiline: "Write this Operandi .{{method}}() call across multiple lines." },
  },
  createOnce(context) {
    const { originatesFrom } = createBindings(context)

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)
        if (callee.type !== "MemberExpression") return
        const method = memberName(callee)
        if (!method || !multilineMethods.has(method)) return

        // A chain may start on an earlier line, measure only this method call
        // eslint-disable-next-line typescript/no-unnecessary-condition -- Parser locations can be absent at runtime
        if (callee.property.loc?.start.line !== node.loc?.end.line) return
        if (!originatesFrom(callee.object, "builder")) return
        context.report({ node: callee.property, messageId: "multiline", data: { method } })
      },
    }
  },
}
