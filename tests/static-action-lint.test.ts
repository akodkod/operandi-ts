import plugin from "../src/eslint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const prelude = 'import { createAction, createActionMiddleware } from "operandi";\n'
const cases = [
  { name: "const", code: prelude + "const action = createAction();", count: 0 },
  { name: "exported const", code: prelude + "export const action = createAction();", count: 0 },
  { name: "named action", code: prelude + 'const action = createAction("Save user");', count: 0 },
  {
    name: "builder chain",
    code:
      prelude + 'const action = createAction().input(schema).output(schema).step("save", handler);',
    count: 0,
  },
  {
    name: "hook chain",
    code:
      prelude +
      'export const action = createAction().use(middleware).errors({}).beforeRun("start", handler).step("save", handler).afterRun("end", handler);',
    count: 0,
  },
  {
    name: "computed builder method",
    code: prelude + 'const action = createAction()["input"](schema);',
    count: 0,
  },
  {
    name: "multiple declarations",
    code: prelude + "const first = createAction(), second = createAction();",
    count: 0,
  },
  {
    name: "separate execution",
    code: prelude + "const action = createAction(); function run() { return action.run(); }",
    count: 0,
  },
  { name: "let", code: prelude + "let action = createAction();", count: 1 },
  { name: "var", code: prelude + "var action = createAction();", count: 1 },
  { name: "unassigned", code: prelude + "createAction();", count: 1 },
  { name: "reassignment", code: prelude + "let action; action = createAction();", count: 1 },
  { name: "destructuring", code: prelude + "const { run } = createAction();", count: 1 },
  {
    name: "function declaration",
    code: prelude + "function build() { const action = createAction(); return action; }",
    count: 1,
  },
  {
    name: "function expression",
    code: prelude + "const build = function() { const action = createAction(); };",
    count: 1,
  },
  { name: "arrow", code: prelude + "const build = () => createAction();", count: 1 },
  {
    name: "async function",
    code: prelude + "async function build() { const action = createAction(); }",
    count: 1,
  },
  {
    name: "generator",
    code: prelude + "function* build() { const action = createAction(); yield action; }",
    count: 1,
  },
  {
    name: "callback",
    code: prelude + "items.map(() => { const action = createAction(); return action; });",
    count: 1,
  },
  { name: "IIFE", code: prelude + "const action = (() => createAction())();", count: 1 },
  {
    name: "method",
    code: prelude + "const factory = { build() { const action = createAction(); } };",
    count: 1,
  },
  { name: "class field", code: prelude + "class Factory { action = createAction(); }", count: 1 },
  {
    name: "static class field",
    code: prelude + "class Factory { static action = createAction(); }",
    count: 1,
  },
  {
    name: "class method",
    code: prelude + "class Factory { build() { const action = createAction(); } }",
    count: 1,
  },
  {
    name: "class static block",
    code: prelude + "class Factory { static { const action = createAction(); } }",
    count: 1,
  },
  {
    name: "default argument",
    code: prelude + "function run(action = createAction()) {}",
    count: 1,
  },
  {
    name: "conditional block",
    code: prelude + "if (enabled) { const action = createAction(); }",
    count: 1,
  },
  {
    name: "loop",
    code: prelude + "for (const item of items) { const action = createAction(); }",
    count: 1,
  },
  { name: "ternary", code: prelude + "const action = enabled ? createAction() : other;", count: 1 },
  {
    name: "logical expression",
    code: prelude + "const action = enabled && createAction();",
    count: 1,
  },
  {
    name: "sequence expression",
    code: prelude + "const action = (log(), createAction());",
    count: 1,
  },
  {
    name: "object property",
    code: prelude + "const actions = { save: createAction() };",
    count: 1,
  },
  { name: "array element", code: prelude + "const actions = [createAction()];", count: 1 },
  {
    name: "wrapped in another call",
    code: prelude + "const action = wrap(createAction());",
    count: 1,
  },
  { name: "inline run", code: prelude + "const result = createAction().run();", count: 1 },
  {
    name: "inline safe run",
    code: prelude + "const result = createAction().input(schema).runSafe();",
    count: 1,
  },
  { name: "default export expression", code: prelude + "export default createAction();", count: 1 },
  {
    name: "default export reference",
    code: prelude + "const action = createAction(); export default action;",
    count: 0,
  },
  {
    name: "renamed import",
    code: 'import { createAction as action } from "operandi"; function build() { const save = action(); }',
    count: 1,
  },
  {
    name: "namespace",
    code: 'import * as op from "operandi"; const action = op.createAction();',
    count: 0,
  },
  {
    name: "dynamic namespace",
    code: 'import * as op from "operandi"; function build() { const action = op["createAction"](); }',
    count: 1,
  },
  {
    name: "factory alias",
    code:
      prelude +
      "const factory = createAction; const alias = factory; function build() { const action = alias(); }",
    count: 1,
  },
  {
    name: "static factory alias",
    code: prelude + "const factory = createAction; const action = factory();",
    count: 0,
  },
  {
    name: "middleware factory",
    code: prelude + "function build() { return createActionMiddleware(); }",
    count: 0,
  },
  {
    name: "namespace middleware factory",
    code: 'import * as op from "operandi"; function build() { return op.createActionMiddleware(); }',
    count: 0,
  },
  {
    name: "shadowed factory",
    code: prelude + "function build(createAction) { return createAction(); }",
    count: 0,
  },
  {
    name: "unrelated import",
    code: 'import { createAction } from "other"; function build() { return createAction(); }',
    count: 0,
  },
  { name: "unbound factory", code: "function build() { return createAction(); }", count: 0 },
  {
    name: "nested action in step",
    code:
      prelude +
      'const action = createAction().step("nested", () => { const nested = createAction(); });',
    count: 1,
  },
]

for (const fixture of cases) {
  test(`static-action-declaration: ${fixture.name}`, () => {
    const messages = new Linter().verify(fixture.code, {
      plugins: { operandi: plugin },
      rules: { "operandi/static-action-declaration": "error" },
    })
    expect(messages).toHaveLength(fixture.count)
    for (const message of messages) {
      expect(message.ruleId).toBe("operandi/static-action-declaration")
      expect(message.messageId).toBe("static")
      expect(message.fix).toBeUndefined()
    }
  })
}

test("static-action-declaration is opt-in and supports configured imports", () => {
  const linter = new Linter()
  expect(linter.verify(prelude + "createAction();", { plugins: { operandi: plugin } })).toEqual([])
  const code = 'import { createAction } from "../src/index"; createAction();'
  expect(
    linter.verify(code, {
      plugins: { operandi: plugin },
      rules: { "operandi/static-action-declaration": "error" },
    }),
  ).toEqual([])
  const messages = linter.verify(code, {
    plugins: { operandi: plugin },
    rules: { "operandi/static-action-declaration": ["error", { importSources: ["../src/index"] }] },
  })
  expect(messages).toHaveLength(1)
  expect(messages[0]?.ruleId).toBe("operandi/static-action-declaration")
})

test("static-action-declaration runs in Oxlint across files and TypeScript wrappers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-static-action-"))
  try {
    const build = await Bun.build({
      entrypoints: [resolve("src/oxlint.ts")],
      outdir: directory,
      target: "node",
    })
    expect(build.success).toBe(true)
    const config = join(directory, ".oxlintrc.json")
    await writeFile(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [{ name: "operandi", specifier: join(directory, "oxlint.js") }],
        rules: {
          "operandi/static-action-declaration": [
            "error",
            { importSources: ["operandi", "../src/index"] },
          ],
        },
      }),
    )
    const fixtures = [
      ...cases,
      { code: prelude + "const action = ((createAction() as unknown) as Action);", count: 0 },
      {
        code: prelude + "export const action = (createAction().input(schema) satisfies Action)!;",
        count: 0,
      },
      {
        code: prelude + 'const action = (createAction() as Action).step("save", handler);',
        count: 0,
      },
      { code: prelude + "const action = (createAction as Factory)();", count: 0 },
      { code: prelude + "const action = createAction<T>();", count: 0 },
      { code: prelude + "function build() { const action = createAction() as Action; }", count: 1 },
      { code: 'import type { createAction } from "operandi"; createAction();', count: 0 },
      { code: 'import { createAction } from "../src/index"; createAction();', count: 1 },
    ]
    const filenames: string[] = []
    for (const [index, fixture] of fixtures.entries()) {
      const filename = join(directory, `fixture-${index}.ts`)
      filenames.push(filename)
      await writeFile(filename, fixture.code)
    }
    const result = Bun.spawnSync([
      process.execPath,
      resolve("node_modules/oxlint/bin/oxlint"),
      "-c",
      config,
      "--threads",
      "1",
      "--format",
      "json",
      ...filenames,
    ])
    expect(result.exitCode).toBe(1)
    const diagnostics = JSON.parse(result.stdout.toString()).diagnostics as {
      filename: string
      code: string
    }[]
    expect(diagnostics).toHaveLength(fixtures.reduce((count, fixture) => count + fixture.count, 0))
    for (const [index, fixture] of fixtures.entries()) {
      expect(
        diagnostics.filter((diagnostic) => diagnostic.filename.endsWith(`/fixture-${index}.ts`)),
      ).toHaveLength(fixture.count)
    }
    expect(
      diagnostics.every((diagnostic) => diagnostic.code.includes("static-action-declaration")),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
