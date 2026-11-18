import { createBindings, importSourcesSchema, memberName, type Node, unwrap } from "./shared.ts"
import type { CreateOnceRule, ESTree } from "@oxlint/plugins"

export const multilineSchema: CreateOnceRule = {
  meta: {
    type: "layout",
    docs: {
      description:
        "Require multiline Zod object schemas with multiple properties in Operandi input and output calls",
    },
    schema: importSourcesSchema,
    messages: {
      multiline:
        "Write .{{method}}() with z.object on a new line and each schema property on its own line.",
    },
  },
  createOnce(context) {
    const { originatesFrom, variable } = createBindings(context)

    function isZod(node: Node): boolean {
      const binding = variable(unwrap(node))
      return (
        binding?.defs.some((definition) => {
          if (
            definition.type !== "ImportBinding" ||
            definition.parent?.type !== "ImportDeclaration" ||
            !["zod", "zod/v4", "zod/mini", "zod/v4/mini"].includes(definition.parent.source.value)
          )
            return false
          const declaration = definition.parent as typeof definition.parent & {
            importKind?: string
          }
          const specifier = definition.node as typeof definition.node & { importKind?: string }
          if (declaration.importKind === "type" || specifier.importKind === "type") return false
          if (
            specifier.type === "ImportNamespaceSpecifier" ||
            specifier.type === "ImportDefaultSpecifier"
          )
            return true
          return (
            specifier.type === "ImportSpecifier" &&
            (specifier.imported.type === "Identifier"
              ? specifier.imported.name === "z"
              : specifier.imported.value === "z")
          )
        }) ?? false
      )
    }

    function objectSchema(node: Node): ESTree.CallExpression | undefined {
      node = unwrap(node)
      if (node.type !== "CallExpression") return undefined
      const callee = unwrap(node.callee)
      if (callee.type !== "MemberExpression") return undefined
      if (memberName(callee) === "object" && isZod(callee.object)) return node
      return objectSchema(callee.object)
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)
        if (callee.type !== "MemberExpression") return
        const method = memberName(callee)
        if (method !== "input" && method !== "output") return
        if (!originatesFrom(callee.object, "builder")) return
        const argument = node.arguments[0]
        if (!argument) return
        const schema = objectSchema(argument)
        if (!schema) return
        const shapeArgument = schema.arguments[0]
        const shape = shapeArgument && unwrap(shapeArgument)
        if (shape?.type !== "ObjectExpression" || shape.properties.length <= 1) return
        let multiline =
          schema.loc.start.line > callee.loc.end.line && node.loc.end.line > argument.loc.end.line
        let previousLine = shape.loc.start.line
        for (const property of shape.properties) {
          multiline = multiline && property.loc.start.line > previousLine
          previousLine = property.loc.end.line
        }
        multiline = multiline && shape.loc.end.line > previousLine
        if (!multiline)
          context.report({ node: callee.property, messageId: "multiline", data: { method } })
      },
    }
  },
}
