import plugin from "../src/eslint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const prelude = 'import { createAction, createActionMiddleware } from "operandi";\n'
const options = { ignore: ["API", "GraphQL"], importSources: ["operandi", "../src/index"] }

const names = [
  { name: "fetch user", count: 0 },
  { name: "Fetch user", count: 1 },
  { name: "fETCH user", count: 0 },
  { name: "API request", count: 0 },
  { name: "API", count: 0 },
  { name: "API: request", count: 0 },
  { name: "API-request", count: 0 },
  { name: "API\trequest", count: 0 },
  { name: "GraphQL query", count: 0 },
  { name: "GRAPHQL query", count: 1 },
  { name: "APIClient request", count: 1 },
  { name: "API2 request", count: 1 },
  { name: "API_client request", count: 1 },
  { name: "APIé request", count: 1 },
  { name: "API\u0301 request", count: 1 },
  { name: "Read API", count: 1 },
  { name: "écrire", count: 0 },
  { name: "Écrire", count: 1 },
  { name: "зберегти", count: 0 },
  { name: "Зберегти", count: 1 },
  { name: "1st request", count: 1 },
  { name: "_fetch", count: 1 },
  { name: " fetch", count: 1 },
  { name: " API request", count: 1 },
  { name: "🚀 launch", count: 1 },
  { name: "", count: 1 },
]

const cases = [
  ...names.map(({ name, count }) => ({
    name: JSON.stringify(name),
    code: prelude + `createAction().step(${JSON.stringify(name)}, handler);`,
    count,
  })),
  {
    name: "middleware",
    code: prelude + 'createActionMiddleware().step("Save", handler);',
    count: 1,
  },
  {
    name: "static template",
    code: prelude + "createAction().step(`Save user`, handler);",
    count: 1,
  },
  {
    name: "ignored template",
    code: prelude + "createAction().step(`API request`, handler);",
    count: 0,
  },
  {
    name: "dynamic template",
    code: prelude + "createAction().step(`Save ${user}`, handler);",
    count: 0,
  },
  { name: "variable name", code: prelude + "createAction().step(name, handler);", count: 0 },
  { name: "non-string", code: prelude + "createAction().step(123, handler);", count: 0 },
  { name: "missing name", code: prelude + "createAction().step();", count: 0 },
  { name: "hook", code: prelude + 'createAction().beforeRun("Start", handler);', count: 0 },
  {
    name: "computed method and alias",
    code:
      prelude +
      'const base = createAction().input(schema); const alias = base; alias["step"]("Save", handler);',
    count: 1,
  },
  {
    name: "renamed factory",
    code: 'import { createAction as action } from "operandi"; action().step("Save", handler);',
    count: 1,
  },
  {
    name: "namespace",
    code: 'import * as op from "operandi"; op.createAction().step("Save", handler);',
    count: 1,
  },
  {
    name: "shadowed factory",
    code: prelude + 'function local(createAction) { createAction().step("Save", handler); }',
    count: 0,
  },
  { name: "unrelated method", code: prelude + 'other.step("Save", handler);', count: 0 },
  {
    name: "other import",
    code: 'import { createAction } from "other"; createAction().step("Save", handler);',
    count: 0,
  },
  {
    name: "configured source",
    code: 'import { createAction } from "../src/index"; createAction().step("Save", handler);',
    count: 1,
  },
]

for (const fixture of cases) {
  test(`step-name-starts-with-lowercase: ${fixture.name}`, () => {
    const messages = new Linter().verify(fixture.code, {
      plugins: { operandi: plugin },
      rules: { "operandi/step-name-starts-with-lowercase": ["error", options] },
    })

    expect(messages).toHaveLength(fixture.count)

    for (const message of messages) {
      expect(message.ruleId).toBe("operandi/step-name-starts-with-lowercase")
      expect(message.messageId).toBe("lowercase")
      expect(message.fix).toBeUndefined()
    }
  })
}

test("step-name-starts-with-lowercase is opt-in and has no default ignored words", () => {
  const code = prelude + 'createAction().step("API request", handler);'
  const linter = new Linter()
  expect(linter.verify(code, { plugins: { operandi: plugin } })).toEqual([])

  const messages = linter.verify(code, {
    plugins: { operandi: plugin },
    rules: { "operandi/step-name-starts-with-lowercase": "error" },
  })

  expect(messages).toHaveLength(1)
  expect(messages[0]?.ruleId).toBe("operandi/step-name-starts-with-lowercase")

  expect(
    linter.verify(prelude + 'createAction().step("HTTP request", handler);', {
      plugins: { operandi: plugin },
      rules: { "operandi/step-name-starts-with-lowercase": ["error", { ignore: ["HTTP"] }] },
    }),
  ).toEqual([])
})

test("step-name-starts-with-lowercase runs in Oxlint across files and TypeScript wrappers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-step-name-"))

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
        rules: { "operandi/step-name-starts-with-lowercase": ["error", options] },
      }),
    )

    const fixtures = [
      ...cases,
      { code: prelude + '(createAction() as Builder).step("Save" as const, handler);', count: 1 },
      {
        code: prelude + "createAction().step((`API request` satisfies string)!, handler);",
        count: 0,
      },
      {
        code: 'import type { createAction } from "operandi"; createAction().step("Save", handler);',
        count: 0,
      },
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
      diagnostics.every((diagnostic) =>
        diagnostic.code.includes("step-name-starts-with-lowercase"),
      ),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
