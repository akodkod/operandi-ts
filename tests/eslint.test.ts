import plugin from "../src/eslint"
import oxlintPlugin from "../src/oxlint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const prelude = 'import { createAction, createActionMiddleware } from "operandi";\n'

const cases = [
  { code: prelude + 'createAction().step("save", () => save());', count: 1 },
  { code: prelude + 'createAction()\n.input(schema)\n.step("save", () => save());', count: 1 },
  { code: prelude + 'createAction().step("save", () => {\n  save();\n});', count: 0 },
  { code: prelude + 'createAction().step(\n"save", handler\n);', count: 0 },
  { code: prelude + 'createAction().step("one", handler).step("two", handler);', count: 2 },
  { code: prelude + 'createActionMiddleware().step("auth", handler);', count: 1 },
  {
    code: 'import { createAction as action } from "operandi"; action().step("a", handler);',
    count: 1,
  },
  { code: 'import * as op from "operandi"; op.createAction().step("a", handler);', count: 1 },
  {
    code:
      prelude +
      'const factory = createAction; const base = factory().input(schema); const alias = base; alias["step"]("a", handler);',
    count: 1,
  },
  {
    code: prelude + 'function local(createAction) { createAction().step("a", handler); }',
    count: 0,
  },
  { code: 'import { createAction } from "other"; createAction().step("a", handler);', count: 0 },
  { code: 'other.step("a", handler);', count: 0 },
  { code: prelude + 'createAction().run().step("a", handler);', count: 0 },
  {
    code:
      prelude + 'const base = createAction(); function local(base) { base.step("a", handler); }',
    count: 0,
  },
  { code: prelude + 'let base = createAction(); base = other; base.step("a", handler);', count: 0 },
  {
    code: prelude + 'const first = second; const second = first; first.step("a", handler);',
    count: 0,
  },
]

const hooks = ["beforeRun", "afterRun", "aroundRun", "beforeStep", "afterStep", "aroundStep"]

for (const method of hooks) {
  cases.push(
    { code: prelude + `createAction()\n.${method}("hook", handler);`, count: 1 },
    { code: prelude + `createActionMiddleware().${method}("hook", handler);`, count: 1 },
    { code: prelude + `createAction().${method}("hook", () => {\n  work();\n});`, count: 0 },
    { code: prelude + `createAction().${method}(\n"hook", handler\n);`, count: 0 },
    {
      code: prelude + `const action = createAction(); action["${method}"]("hook", handler);`,
      count: 1,
    },
    { code: prelude + `other.${method}("hook", handler);`, count: 0 },
    {
      code: prelude + `function local(createAction) { createAction().${method}("hook", handler); }`,
      count: 0,
    },
  )
}

cases.push(
  {
    code:
      prelude +
      'createAction().beforeRun("start", handler).step("save", handler).afterRun("end", handler);',
    count: 3,
  },
  {
    code: prelude + "createAction().input(schema).output(schema).errors({}).use(middleware);",
    count: 0,
  },
)

for (const [index, fixture] of cases.entries()) {
  test(`multiline-steps ESLint case ${index + 1}`, () => {
    const messages = new Linter().verify(fixture.code, {
      plugins: { operandi: plugin },
      rules: { "operandi/multiline-steps": "error" },
    })

    expect(messages).toHaveLength(fixture.count)

    for (const message of messages) {
      expect(message.ruleId).toBe("operandi/multiline-steps")
      expect(message.messageId).toBe("multiline")
      expect(message.fix).toBeUndefined()
    }
  })
}

test("multiline-steps is opt-in", () => {
  expect(
    new Linter().verify(prelude + 'createAction().step("a", handler);', {
      plugins: { operandi: plugin },
    }),
  ).toEqual([])
})

test("multiline-steps supports configured import sources", () => {
  const code = 'import { createAction } from "../src/index"; createAction().step("a", handler);'
  const linter = new Linter()

  expect(
    linter.verify(code, {
      plugins: { operandi: plugin },
      rules: { "operandi/multiline-steps": "error" },
    }),
  ).toEqual([])

  const messages = linter.verify(code, {
    plugins: { operandi: plugin },
    rules: {
      "operandi/multiline-steps": ["error", { importSources: ["operandi", "../src/index"] }],
    },
  })

  expect(messages).toHaveLength(1)
  expect(messages[0]?.ruleId).toBe("operandi/multiline-steps")
})

test("multiline-steps runs in Oxlint, including TypeScript wrappers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-lint-"))

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
          "operandi/multiline-steps": ["error", { importSources: ["operandi", "../src/index"] }],
        },
      }),
    )

    const typescriptCases = [
      {
        code: 'import { createAction } from "../src/index"; createAction().step("a", handler);',
        count: 1,
      },
      { code: prelude + '(createAction() as Builder).step("a", handler);', count: 1 },
      { code: prelude + '(createAction() satisfies Builder)!.step("a", handler);', count: 1 },
      {
        code: 'import type { createAction } from "operandi"; createAction().step("a", handler);',
        count: 0,
      },
    ]

    const filenames: string[] = []

    for (const [index, fixture] of [...cases, ...typescriptCases].entries()) {
      const filename = join(directory, `fixture-${index}.ts`)
      filenames.push(filename)
      await writeFile(filename, fixture.code)

      const result = Bun.spawnSync([
        process.execPath,
        resolve("node_modules/oxlint/bin/oxlint"),
        "-c",
        config,
        "--format",
        "json",
        filename,
      ])

      const output = JSON.parse(result.stdout.toString())
      expect(output.diagnostics).toHaveLength(fixture.count)
      expect(result.exitCode).toBe(fixture.count ? 1 : 0)

      for (const diagnostic of output.diagnostics)
        expect(diagnostic.code).toContain("multiline-steps")
    }

    const batch = Bun.spawnSync([
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

    const diagnostics = JSON.parse(batch.stdout.toString()).diagnostics
    expect(batch.exitCode).toBe(1)

    expect(diagnostics).toHaveLength(
      [...cases, ...typescriptCases].reduce((count, fixture) => count + fixture.count, 0),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Oxlint entry point uses createOnce without an ESLint adapter", () => {
  const rule = oxlintPlugin.rules["multiline-steps"]
  expect(rule).toHaveProperty("createOnce")
  expect(rule).not.toHaveProperty("create")
})

test("multiline hook diagnostics name the offending method", () => {
  for (const method of hooks) {
    const messages = new Linter().verify(prelude + `createAction().${method}("hook", handler);`, {
      plugins: { operandi: plugin },
      rules: { "operandi/multiline-steps": "error" },
    })

    expect(messages[0]?.message).toBe(
      `Write this Operandi .${method}() call across multiple lines.`,
    )
  }
})
