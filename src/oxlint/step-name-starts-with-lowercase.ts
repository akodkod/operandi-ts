import { createBindings, memberName, unwrap } from "./shared.ts"
import type { CreateOnceRule } from "@oxlint/plugins"

export const stepNameStartsWithLowercase: CreateOnceRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Require Operandi step names to start with a lowercase letter" },
    schema: [
      {
        type: "object",
        properties: {
          importSources: { type: "array", items: { type: "string" }, uniqueItems: true },
          ignore: {
            type: "array",
            items: { type: "string", minLength: 1, pattern: "^\\S+$" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      lowercase:
        "Start the step name with a lowercase letter or add its opening word to the ignore list.",
    },
  },
  createOnce(context) {
    const { originatesFrom } = createBindings(context)

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)

        if (callee.type !== "MemberExpression" || memberName(callee) !== "step") return
        if (!originatesFrom(callee.object, "builder")) return

        const argument = node.arguments[0]
        if (!argument) return

        const nameNode = unwrap(argument)

        const name =
          nameNode.type === "Literal" && typeof nameNode.value === "string"
            ? nameNode.value
            : nameNode.type === "TemplateLiteral" && nameNode.expressions.length === 0
              ? nameNode.quasis[0]?.value.cooked
              : undefined

        if (name == null || /^\p{Ll}/u.test(name)) return

        const options = context.options[0] as { ignore?: string[] } | undefined
        const openingWord = /^[\p{L}\p{M}\p{N}_]+/u.exec(name)?.[0]

        if (openingWord && options?.ignore?.includes(openingWord)) return

        context.report({ node: nameNode, messageId: "lowercase" })
      },
    }
  },
}
