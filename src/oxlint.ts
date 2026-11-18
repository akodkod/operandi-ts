import type { CreateOnceRule, ESTree, Plugin, Scope, Variable } from "@oxlint/plugins"

type Node = ESTree.Node
type MemberExpression = ESTree.MemberExpression

const factories = new Set(["createAction", "createActionMiddleware"])
const multilineMethods = new Set([
  "step",
  "beforeRun",
  "afterRun",
  "aroundRun",
  "beforeStep",
  "afterStep",
  "aroundStep",
])
const builderMethods = new Set(["input", "output", "errors", "use", ...multilineMethods])

function unwrap(node: Node): Node {
  // TypeScript parsers expose these wrappers in addition to ESTree nodes
  while (
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
      "ChainExpression",
    ].includes(node.type)
  ) {
    node = (node as unknown as { expression: Node }).expression
  }
  return node
}

function memberName(node: MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") return node.property.name
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string")
    return node.property.value
  return undefined
}

const multilineSteps: CreateOnceRule = {
  meta: {
    type: "layout",
    docs: { description: "Require Operandi step and lifecycle hook calls to span multiple lines" },
    schema: [
      {
        type: "object",
        properties: {
          importSources: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: { multiline: "Write this Operandi .{{method}}() call across multiple lines." },
  },
  createOnce(context) {
    function variable(node: Node): Variable | undefined {
      if (node.type !== "Identifier") return undefined
      let scope: Scope | null = context.sourceCode.getScope(node)
      while (scope) {
        const binding = scope.set.get(node.name)
        if (binding) return binding
        scope = scope.upper
      }
      return undefined
    }

    function imported(node: Node, namespace = false): boolean {
      const options = context.options[0] as { importSources?: string[] } | undefined
      const sources = options?.importSources ?? ["operandi"]
      const binding = variable(node)
      return (
        binding?.defs.some((definition) => {
          if (
            definition.type !== "ImportBinding" ||
            definition.parent?.type !== "ImportDeclaration" ||
            !sources.includes(definition.parent.source.value)
          )
            return false
          const declaration = definition.parent as typeof definition.parent & {
            importKind?: string
          }
          const specifier = definition.node as typeof definition.node & { importKind?: string }
          if (declaration.importKind === "type" || specifier.importKind === "type") return false
          if (namespace) return specifier.type === "ImportNamespaceSpecifier"
          if (specifier.type !== "ImportSpecifier") return false
          const name =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value
          return typeof name === "string" && factories.has(name)
        }) ?? false
      )
    }

    function originatesFrom(
      node: Node,
      kind: "builder" | "factory",
      seen = new Set<Variable>(),
    ): boolean {
      node = unwrap(node)
      if (node.type === "Identifier") {
        if (kind === "factory" && imported(node)) return true
        const binding = variable(node)
        if (!binding || seen.has(binding) || binding.defs.length !== 1) return false
        seen.add(binding)
        const definition = binding.defs[0]
        if (
          definition?.type !== "Variable" ||
          definition.parent?.type !== "VariableDeclaration" ||
          definition.parent.kind !== "const" ||
          definition.node.type !== "VariableDeclarator" ||
          definition.node.id.type !== "Identifier" ||
          !definition.node.init
        )
          return false
        return originatesFrom(definition.node.init, kind, seen)
      }
      if (kind === "factory") {
        return (
          node.type === "MemberExpression" &&
          factories.has(memberName(node) ?? "") &&
          imported(unwrap(node.object), true)
        )
      }
      if (node.type !== "CallExpression") return false
      const callee = unwrap(node.callee)
      if (originatesFrom(callee, "factory", new Set(seen))) return true
      return (
        callee.type === "MemberExpression" &&
        builderMethods.has(memberName(callee) ?? "") &&
        originatesFrom(callee.object, "builder", seen)
      )
    }

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

const plugin: Plugin = {
  meta: { name: "operandi" },
  rules: { "multiline-steps": multilineSteps },
}

export default plugin
