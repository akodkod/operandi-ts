import plugin from "../src/eslint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const prelude =
  'import { createAction, createActionMiddleware } from "operandi"; import { z } from "zod";\n'
const valid =
  "createAction().input(\n  z.object({\n    id: z.string(),\n    name: z.string(),\n  }),\n);"
const cases = [
  {
    name: "empty input stays inline",
    code: prelude + "createAction().input(z.object({}));",
    count: 0,
  },
  {
    name: "single-property input stays inline",
    code: prelude + "createAction().input(z.object({ id: z.string() }));",
    count: 0,
  },
  {
    name: "single-property output stays inline",
    code: prelude + "createActionMiddleware().output(z.object({ id: z.string() }));",
    count: 0,
  },
  {
    name: "single-property chained schema stays inline",
    code: prelude + "createAction().output(z.object({ id: z.string() }).strict());",
    count: 0,
  },
  {
    name: "nested properties do not count toward the outer shape",
    code:
      prelude +
      "createAction().input(z.object({ user: z.object({ id: z.string(), name: z.string() }) }));",
    count: 0,
  },
  {
    name: "shape reference is not counted",
    code: prelude + "createAction().input(z.object(fields));",
    count: 0,
  },
  {
    name: "single spread stays inline",
    code: prelude + "createAction().input(z.object({ ...fields }));",
    count: 0,
  },
  {
    name: "spread and property need line breaks",
    code: prelude + "createAction().input(z.object({ ...fields, id: z.string() }));",
    count: 1,
  },
  {
    name: "single-property multiline is still allowed",
    code: prelude + "createAction().input(\n z.object({\n id: z.string(),\n }),\n);",
    count: 0,
  },
  { name: "multiline input", code: prelude + valid, count: 0 },
  { name: "multiline output", code: prelude + valid.replace(".input(", ".output("), count: 0 },
  {
    name: "inline input",
    code: prelude + "createAction().input(z.object({ id: z.string(), name: z.string() }));",
    count: 1,
  },
  {
    name: "inline middleware output",
    code:
      prelude + "createActionMiddleware().output(z.object({ id: z.string(), name: z.string() }));",
    count: 1,
  },
  {
    name: "schema stays on input line",
    code:
      prelude + "createAction().input(z.object({\n id: z.string(),\n name: z.string(),\n}),\n);",
    count: 1,
  },
  {
    name: "inline properties",
    code: prelude + "createAction().input(\n z.object({ id: z.string(), name: z.string() }),\n);",
    count: 1,
  },
  {
    name: "properties share a line",
    code:
      prelude + "createAction().input(\n z.object({\n id: z.string(), name: z.string(),\n }),\n);",
    count: 1,
  },
  {
    name: "closing brace shares a property line",
    code: prelude + "createAction().input(\n z.object({\n id: z.string(),\n name: z.string() }),\n);",
    count: 1,
  },
  {
    name: "outer closing parenthesis stays inline",
    code:
      prelude + "createAction().input(\n z.object({\n id: z.string(),\n name: z.string(),\n }));",
    count: 1,
  },
  {
    name: "chained schema",
    code:
      prelude + "createAction().output(z.object({ id: z.string(), name: z.string() }).strict());",
    count: 1,
  },
  {
    name: "multiline chained schema",
    code: prelude + valid.replace("  }),", "  }).strict(),"),
    count: 0,
  },
  {
    name: "Zod alias",
    code: 'import { createAction as action } from "operandi"; import { z as schema } from "zod/v4"; action().input(schema.object({ id: z.string(), name: z.string() }));',
    count: 1,
  },
  {
    name: "Zod namespace",
    code: 'import * as op from "operandi"; import * as z from "zod"; op.createAction().output(z.object({ id: z.string(), name: z.string() }));',
    count: 1,
  },
  {
    name: "Zod default import",
    code: 'import { createAction } from "operandi"; import z from "zod"; createAction().input(z.object({ id: z.string(), name: z.string() }));',
    count: 1,
  },
  {
    name: "builder alias",
    code:
      prelude +
      'const base = createAction(); const alias = base; alias["input"](z.object({ id: z.string(), name: z.string() }));',
    count: 1,
  },
  {
    name: "unrelated builder",
    code: prelude + "other.input(z.object({ id: z.string(), name: z.string() }));",
    count: 0,
  },
  {
    name: "other validator",
    code: prelude + "createAction().input(v.object({ id: z.string(), name: z.string() }));",
    count: 0,
  },
  { name: "other Zod schema", code: prelude + "createAction().input(z.string());", count: 0 },
  {
    name: "schema reference",
    code:
      prelude +
      "const schema = z.object({ id: z.string(), name: z.string() }); createAction().input(schema);",
    count: 0,
  },
  {
    name: "shadowed Zod",
    code:
      prelude +
      "function local(z) { createAction().input(z.object({ id: z.string(), name: z.string() })); }",
    count: 0,
  },
  {
    name: "shadowed factory",
    code:
      prelude +
      "function local(createAction) { createAction().input(z.object({ id: z.string(), name: z.string() })); }",
    count: 0,
  },
  {
    name: "unrelated import",
    code: 'import { createAction } from "operandi"; import { z } from "other"; createAction().input(z.object({ id: z.string(), name: z.string() }));',
    count: 0,
  },
  { name: "missing argument", code: prelude + "createAction().input();", count: 0 },
  {
    name: "schema elsewhere",
    code: prelude + "const schema = z.object({ id: z.string(), name: z.string() });",
    count: 0,
  },
  {
    name: "spread property",
    code: prelude + "createAction().input(\n z.object({\n ...fields,\n id: z.string(),\n }),\n);",
    count: 0,
  },
  {
    name: "comments",
    code:
      prelude +
      "createAction().input(\n // User schema\n z.object({\n // Identifier\n id: z.string(),\n name: z.string(),\n }),\n);",
    count: 0,
  },
]

for (const fixture of cases) {
  test(`multiline-schema: ${fixture.name}`, () => {
    const messages = new Linter().verify(fixture.code, {
      plugins: { operandi: plugin },
      rules: { "operandi/multiline-schema": "error" },
    })
    expect(messages).toHaveLength(fixture.count)
    for (const message of messages) {
      expect(message.ruleId).toBe("operandi/multiline-schema")
      expect(message.messageId).toBe("multiline")
    }
  })
}

test("multiline-schema is opt-in and supports configured import sources", () => {
  const code =
    prelude.replace('"operandi"', '"../src/index"') +
    "createAction().input(z.object({ id: z.string(), name: z.string() }));"
  const linter = new Linter()
  expect(linter.verify(code, { plugins: { operandi: plugin } })).toEqual([])
  expect(
    linter.verify(code, {
      plugins: { operandi: plugin },
      rules: { "operandi/multiline-schema": "error" },
    }),
  ).toEqual([])
  const messages = linter.verify(code, {
    plugins: { operandi: plugin },
    rules: {
      "operandi/multiline-schema": ["error", { importSources: ["operandi", "../src/index"] }],
    },
  })
  expect(messages).toHaveLength(1)
  expect(messages[0]?.ruleId).toBe("operandi/multiline-schema")
})

test("multiline-schema runs in Oxlint across files and TypeScript wrappers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-schema-lint-"))
  try {
    const config = join(directory, ".oxlintrc.json")
    const build = await Bun.build({
      entrypoints: [resolve("src/oxlint.ts")],
      outdir: directory,
      target: "node",
    })
    expect(build.success).toBe(true)
    await writeFile(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [{ name: "operandi", specifier: join(directory, "oxlint.js") }],
        rules: {
          "operandi/multiline-schema": ["error", { importSources: ["operandi", "../src/index"] }],
        },
      }),
    )
    const fixtures = [
      ...cases,
      {
        code:
          prelude +
          "(createAction() as Builder).input((z.object({ id: z.string(), name: z.string() }) satisfies Schema)!);",
        count: 1,
      },
      {
        code: 'import { createAction } from "operandi"; import type { z } from "zod"; createAction().input(z.object({ id: z.string(), name: z.string() }));',
        count: 0,
      },
      {
        code: 'import { createAction } from "operandi"; import { type z } from "zod"; createAction().input(z.object({ id: z.string(), name: z.string() }));',
        count: 0,
      },
      {
        code:
          prelude.replace('"operandi"', '"../src/index"') +
          "createAction().input(z.object({ id: z.string(), name: z.string() }));",
        count: 1,
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
    expect(diagnostics.every((diagnostic) => diagnostic.code.includes("multiline-schema"))).toBe(
      true,
    )

    const formatted = join(directory, "formatted.ts")
    await writeFile(formatted, prelude + valid)
    const format = Bun.spawnSync([process.execPath, "fmt", formatted])
    expect(format.exitCode).toBe(0)
    expect(
      new Linter().verify(await readFile(formatted, "utf8"), {
        plugins: { operandi: plugin },
        rules: { "operandi/multiline-schema": "error" },
      }),
    ).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
