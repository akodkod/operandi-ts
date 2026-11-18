import { operandiNames, type OperandiNamesOptions, OperandiNameType } from "../src/vite"
import { expect, test } from "bun:test"
import { build, createServer } from "vite"
import { rejects } from "node:assert/strict"

const imports = 'import { createAction, createActionMiddleware } from "operandi";\n'

async function transform(source: string, options?: OperandiNamesOptions, id = "/app/actions.ts") {
  const hook = operandiNames(options).transform

  if (typeof hook !== "function") throw new Error("Expected transform hook")

  const result = await hook.call({} as never, source, id)

  if (!result || typeof result === "string") return null

  return { ...result, code: String(result.code) }
}

test("names actions and middleware through chains and retains source maps", async () => {
  const source =
    imports +
    `
export const createUser = createAction(/* keep */).input(schema).step("save", () => {});
const authenticate = createActionMiddleware().beforeRun("auth", () => {});
`

  const result = await transform(source)

  expect(result?.code).toContain('createAction(/* keep */"createUser")')
  expect(result?.code).toContain('createActionMiddleware("authenticate")')
  expect(result?.map).toMatchObject({ sources: ["/app/actions.ts"], sourcesContent: [source] })
  expect(await transform(result!.code)).toBeNull()
})

test("customizes names with the factory type and safely escapes returned strings", async () => {
  const contexts: unknown[] = []

  const result = await transform(
    imports + "const user = createAction(); const auth = createActionMiddleware();",
    {
      transformName(context) {
        contexts.push(context)

        return `${context.type}: "${context.name}"\n`
      },
    },
  )

  expect(contexts).toEqual([
    { name: "user", type: OperandiNameType.Action },
    { name: "auth", type: OperandiNameType.Middleware },
  ])
  expect(result?.code).toContain(`createAction(${JSON.stringify('action: "user"\n')})`)
  expect(result?.code).toContain(
    `createActionMiddleware(${JSON.stringify('middleware: "auth"\n')})`,
  )

  expect(
    (await transform(imports + "const user = createAction();", { transformName: () => "" }))?.code,
  ).toContain('createAction("")')
})

test("resolves aliased imports and leaves shadowed factories alone", async () => {
  const source = `import { createAction as action } from "operandi";
const user = action();
function local(action: () => unknown) { const ignored = action(); }
function hoisted() { const ignored = action(); function action() {} }
`

  const result = await transform(source)

  expect(result?.code).toContain('const user = action("user")')
  expect(result?.code.match(/const ignored = action\(\)/g)).toHaveLength(2)
})

test("preserves explicit names and skips unrelated or ambiguous calls", async () => {
  const source =
    imports +
    `
const explicit = createAction("custom");
const dynamic = createAction(getName());
const supplied = createAction(undefined);
const wrapped = wrapper(createAction());
const factory = () => createAction();
const { result } = createAction();
export default createAction();
`

  expect(
    await transform(source, {
      transformName: () => {
        throw new Error("Should not run")
      },
    }),
  ).toBeNull()

  expect(
    await transform('import { createAction } from "another-package"; const user = createAction();'),
  ).toBeNull()
  expect(
    await transform('import type { createAction } from "operandi"; const user = createAction();'),
  ).toBeNull()
})

test("handles TypeScript wrappers, generics, and JSX", async () => {
  const result = await transform(
    imports +
      `
const user = (createAction<string>() as Action).step("save", () => <div />) satisfies Action;
const auth = createActionMiddleware()!;
`,
    undefined,
    "/app/actions.tsx?direct",
  )

  expect(result?.code).toContain('createAction<string>("user")')
  expect(result?.code).toContain('createActionMiddleware("auth")')
})

test("skips dependencies, declarations, and non-script files", async () => {
  for (const id of [
    "/app/node_modules/lib/index.ts",
    "/app/types.d.ts",
    "/app/style.css",
    "/app/Page.vue",
  ]) {
    expect(await transform(imports + "const user = createAction();", undefined, id)).toBeNull()
  }
})

test("propagates callback failures and rejects invalid return values", async () => {
  const source = imports + "const user = createAction();"

  await rejects(
    transform(source, {
      transformName() {
        throw new Error("Naming failed")
      },
    }),
    /Naming failed/,
  )

  await rejects(transform(source, { transformName: (() => 123) as never }), /must return a string/)
})

test("runs in Vite development and production pipelines", async () => {
  const id = "/virtual/operandi-example.ts"

  const plugins = [
    operandiNames({ transformName: ({ name, type }) => `${type}: ${name}` }),
    {
      name: "fixture",
      resolveId(source: string) {
        if (source === id) return id
      },
      load(source: string) {
        if (source === id)
          return (
            imports +
            "export const user = createAction(); export const auth = createActionMiddleware();"
          )
      },
    },
  ]

  const server = await createServer({
    configFile: false,
    plugins,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  })

  try {
    const result = await server.transformRequest(id)

    expect(result?.code).toContain('createAction("action: user")')
    expect(result?.code).toContain('createActionMiddleware("middleware: auth")')
  } finally {
    await server.close()
  }

  const result = await build({
    configFile: false,
    plugins,
    logLevel: "silent",
    build: {
      ssr: id,
      write: false,
      minify: true,
      rollupOptions: { external: ["operandi"] },
    },
  })

  if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one bundle")

  const chunk = result.output.find((item) => item.type === "chunk")

  expect(chunk?.code).toContain("action: user")
  expect(chunk?.code).toContain("middleware: auth")
})
