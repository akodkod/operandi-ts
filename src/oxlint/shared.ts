import type { Context, ESTree, RuleOptionsSchema, Scope, Variable } from "@oxlint/plugins"

export type Node = ESTree.Node
type MemberExpression = ESTree.MemberExpression

const factories = new Set(["createAction", "createActionMiddleware"])

export const multilineMethods = new Set([
  "step",
  "beforeRun",
  "afterRun",
  "aroundRun",
  "beforeStep",
  "afterStep",
  "aroundStep",
])

export const builderMethods = new Set(["input", "output", "errors", "use", ...multilineMethods])

export function unwrap(node: Node): Node {
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

export function memberName(node: MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") return node.property.name

  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string")
    return node.property.value

  return undefined
}

export function createBindings(context: Context, factoryNames = factories) {
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

        return typeof name === "string" && factoryNames.has(name)
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
        factoryNames.has(memberName(node) ?? "") &&
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

  return { originatesFrom, variable }
}

export const importSourcesSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: {
      importSources: { type: "array", items: { type: "string" }, uniqueItems: true },
    },
    additionalProperties: false,
  },
]
