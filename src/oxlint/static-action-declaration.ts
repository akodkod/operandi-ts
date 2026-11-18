// prettier-ignore
import { builderMethods, createBindings, importSourcesSchema, memberName, type Node, unwrap } from "./shared.ts"
import type { CreateOnceRule } from "@oxlint/plugins"

export const staticActionDeclaration: CreateOnceRule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require createAction calls to initialize module-level const declarations",
    },
    schema: importSourcesSchema,
    messages: {
      static:
        "Assign createAction() and its builder chain directly to a module-level const outside functions.",
    },
  },
  createOnce(context) {
    const { originatesFrom } = createBindings(context, new Set(["createAction"]))

    function isStaticDeclaration(node: Node): boolean {
      let expression = node

      while (expression.parent) {
        const parent = expression.parent

        if (unwrap(parent) === unwrap(expression)) {
          expression = parent
          continue
        }

        if (
          parent.type === "MemberExpression" &&
          parent.object === expression &&
          builderMethods.has(memberName(parent) ?? "") &&
          parent.parent.type === "CallExpression" &&
          parent.parent.callee === parent
        ) {
          expression = parent.parent
          continue
        }

        if (
          parent.type !== "VariableDeclarator" ||
          parent.init !== expression ||
          parent.id.type !== "Identifier" ||
          parent.parent.type !== "VariableDeclaration" ||
          parent.parent.kind !== "const"
        )
          return false

        const container = parent.parent.parent

        return (
          container.type === "Program" ||
          (container.type === "ExportNamedDeclaration" && container.parent.type === "Program")
        )
      }

      return false
    }

    return {
      CallExpression(node) {
        if (!originatesFrom(node.callee, "factory") || isStaticDeclaration(node)) return
        context.report({ node, messageId: "static" })
      },
    }
  },
}
