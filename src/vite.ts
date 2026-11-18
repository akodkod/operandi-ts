import { parse } from "@babel/parser"
import traverseModule, { type NodePath } from "@babel/traverse"
import type { Node } from "@babel/types"
import { MagicString } from "magic-string"
import type { Plugin } from "vite"

export enum OperandiNameType {
  Action = "action",
  Middleware = "middleware",
}

export type OperandiNameContext = {
  name: string
  type: OperandiNameType
}

export type OperandiNamesOptions = {
  transformName?: (_context: OperandiNameContext) => string
}

// Babel 7's CommonJS default is wrapped when loaded by Node's ESM loader
const traverse =
  (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule

function unwrap(node: Node): Node {
  while (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  ) {
    node = node.expression
  }

  return node
}

function factoryType(path: NodePath, callee: Node): OperandiNameContext["type"] | undefined {
  if (callee.type !== "Identifier") return

  const binding = path.scope.getBinding(callee.name)

  if (!binding?.path.isImportSpecifier()) return

  const declaration = binding.path.parentPath

  if (!declaration.isImportDeclaration() || declaration.node.source.value !== "operandi") return
  if (declaration.node.importKind === "type" || binding.path.node.importKind === "type") return

  const imported = binding.path.node.imported
  const name = imported.type === "Identifier" ? imported.name : imported.value

  if (name === "createAction") return OperandiNameType.Action
  if (name === "createActionMiddleware") return OperandiNameType.Middleware
}

export function operandiNames(options: OperandiNamesOptions = {}): Plugin {
  return {
    name: "operandi-names",
    enforce: "pre",
    transform(code, id) {
      const filename = id.split("?", 1)[0]!

      if (
        !/\.[cm]?[jt]sx?$/.test(filename) ||
        /\.d\.[cm]?ts$/.test(filename) ||
        filename.replaceAll("\\", "/").includes("/node_modules/") ||
        !code.includes("operandi")
      )
        return null

      const ast = parse(code, {
        sourceType: "module",
        plugins: [
          ...(/\.[cm]?tsx?$/.test(filename) ? ["typescript" as const] : []),
          ...(/\.[jt]sx$/.test(filename) ? ["jsx" as const] : []),
        ],
      })

      const output = new MagicString(code)

      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.type !== "Identifier" || !path.node.init) return

          let expression = unwrap(path.node.init)

          while (expression.type === "CallExpression") {
            const callee = unwrap(expression.callee)
            const type = factoryType(path, callee)

            if (type) {
              if (expression.arguments.length !== 0) return

              const context = { name: path.node.id.name, type }
              const name = options.transformName ? options.transformName(context) : context.name

              if (typeof name !== "string") {
                throw new TypeError("operandiNames transformName must return a string")
              }

              output.appendLeft(expression.end! - 1, JSON.stringify(name))

              return
            }

            if (callee.type !== "MemberExpression" || callee.computed) return

            expression = unwrap(callee.object)
          }
        },
      })

      if (!output.hasChanged()) return null

      return {
        code: output.toString(),
        map: output.generateMap({ source: id, includeContent: true, hires: true }),
      }
    },
  }
}
