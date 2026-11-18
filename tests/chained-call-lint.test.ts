import plugin from "../src/eslint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const prelude = 'import { createAction, createActionMiddleware } from "operandi";\n'
const ruleId = "operandi/newline-per-chained-call"
const options = { importSources: ["operandi", "../src/index"] }

const cases = [
  {
    name: "first call on factory line",
    code:
      prelude +
      'createAction("Complete GitHub Connection").use(WithTransaction)\n  .use(RequireWorkspace);',
    count: 1,
  },
  { name: "all calls inline", code: prelude + "createAction().use(a).use(b).run();", count: 3 },
  {
    name: "separate lines",
    code: prelude + "createAction()\n  .use(a)\n  .use(b)\n  .run();",
    count: 0,
  },
  { name: "multiline receiver", code: prelude + 'createAction(\n  "Name"\n).use(a);', count: 1 },
  { name: "multiline method arguments", code: prelude + "createAction().use(\n  a\n);", count: 1 },
  { name: "middleware", code: prelude + "createActionMiddleware().use(a);", count: 1 },
  { name: "computed call", code: prelude + 'createAction()["use"](a);', count: 1 },
  { name: "computed call on next line", code: prelude + 'createAction()\n  ["use"](a);', count: 0 },
  { name: "dot on previous line", code: prelude + "createAction().\n  use(a);", count: 1 },
  { name: "parenthesized receiver", code: prelude + "(createAction()\n).use(a);", count: 1 },
  { name: "comment", code: prelude + "createAction() /* comment */ .use(a);", count: 1 },
  { name: "line comment", code: prelude + "createAction() // comment\n  .use(a);", count: 0 },
  { name: "optional call", code: prelude + "createAction()?.use(a);", count: 1 },
  {
    name: "standalone run",
    code: prelude + "const action = createAction(); action.run();",
    count: 0,
  },
  {
    name: "builder alias",
    code: prelude + "const base = createAction(); const alias = base; alias.use(a).use(b);",
    count: 1,
  },
  {
    name: "factory alias",
    code: prelude + "const factory = createAction; factory().use(a);",
    count: 1,
  },
  {
    name: "renamed import",
    code: 'import { createAction as action } from "operandi"; action().use(a);',
    count: 1,
  },
  {
    name: "namespace",
    code: 'import * as op from "operandi"; op.createAction().use(a);',
    count: 1,
  },
  {
    name: "shadowed binding",
    code: prelude + "function local(createAction) { createAction().use(a); }",
    count: 0,
  },
  { name: "unrelated chain", code: "other().use(a).run();", count: 0 },
  {
    name: "other package",
    code: 'import { createAction } from "other"; createAction().use(a);',
    count: 0,
  },
  {
    name: "configured source",
    code: 'import { createAction } from "../src/index"; createAction().use(a);',
    count: 1,
  },
  {
    name: "schema chains",
    code: prelude + "createAction()\n  .input(z.string().optional());",
    count: 0,
  },
  {
    name: "promise chain",
    code: prelude + "const action = createAction(); action.run().then(done);",
    count: 0,
  },
  ...[
    "input",
    "output",
    "errors",
    "step",
    "beforeRun",
    "afterRun",
    "aroundRun",
    "beforeStep",
    "afterStep",
    "aroundStep",
    "runSafe",
  ].map((method) => ({
    name: method,
    code: prelude + `createAction().${method}();`,
    count: 1,
  })),
]

for (const fixture of cases) {
  test(`newline-per-chained-call: ${fixture.name}`, () => {
    const messages = new Linter().verify(fixture.code, {
      plugins: { operandi: plugin },
      rules: { [ruleId]: ["error", options] },
    })

    expect(messages).toHaveLength(fixture.count)

    for (const message of messages) {
      expect(message.ruleId).toBe(ruleId)
      expect(message.messageId).toBe("newline")
    }
  })
}

test("newline-per-chained-call supports Oxlint and TypeScript wrappers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-chained-call-"))

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
        rules: { [ruleId]: ["error", options] },
      }),
    )

    const fixtures = [
      ...cases,
      { code: prelude + "(createAction() as Builder).use(a);", count: 1 },
      { code: prelude + "(createAction() satisfies Builder)!\n  .use(a);", count: 0 },
      { code: 'import type { createAction } from "operandi"; createAction().use(a);', count: 0 },
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

    expect(diagnostics).toHaveLength(fixtures.reduce((sum, fixture) => sum + fixture.count, 0))

    for (const [index, fixture] of fixtures.entries()) {
      expect(
        diagnostics.filter((item) => item.filename.endsWith(`/fixture-${index}.ts`)),
      ).toHaveLength(fixture.count)
    }

    expect(diagnostics.every((item) => item.code === "operandi(newline-per-chained-call)")).toBe(
      true,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
