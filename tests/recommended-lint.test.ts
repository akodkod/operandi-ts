import eslintPlugin, { recommended as eslintRecommended } from "../src/eslint"
import oxlintPlugin, { recommended as oxlintRecommended } from "../src/oxlint"
import { expect, test } from "bun:test"
import { Linter } from "eslint"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const invalid = `import { createAction } from "operandi";
import { z } from "zod";
function build() {
  const action = createAction().input(z.object({ id: z.string(), name: z.string() })).step("Save", handler);
  return action;
}`
const valid = `import { createAction } from "operandi";
import { z } from "zod";
const action = createAction().input(
  z.object({
    id: z.string(),
    name: z.string(),
  }),
).step("save", () => {
  work();
});`
const ruleIds = [
  "operandi/multiline-schema",
  "operandi/multiline-steps",
  "operandi/static-action-declaration",
  "operandi/step-name-starts-with-lowercase",
]

test("recommended ESLint config registers the plugin and enables all rules", () => {
  expect(eslintPlugin.configs.recommended).toBe(eslintRecommended)
  const linter = new Linter()
  expect(linter.verify(valid, eslintRecommended)).toEqual([])
  const messages = linter.verify(invalid, eslintRecommended)
  expect(messages.map((message) => message.ruleId).sort()).toEqual(ruleIds)
  expect(messages.every((message) => message.severity === 2)).toBe(true)
})

test("recommended settings can be overridden without changing the preset", () => {
  const code =
    'import { createAction } from "operandi"; const action = createAction().step("API request", () => {\n work();\n});'
  const linter = new Linter()
  expect(
    linter.verify(code, [
      eslintRecommended,
      {
        rules: { "operandi/step-name-starts-with-lowercase": ["error", { ignore: ["API"] }] },
      },
    ]),
  ).toEqual([])
  expect(linter.verify(code, eslintRecommended).map((message) => message.ruleId)).toEqual([
    "operandi/step-name-starts-with-lowercase",
  ])
})

test("ESLint adaptation leaves native Oxlint rules and config independent", () => {
  expect(oxlintPlugin.configs.recommended).toBe(oxlintRecommended)
  expect(oxlintRecommended.rules).toEqual(eslintRecommended.rules)
  expect(oxlintRecommended.rules).not.toBe(eslintRecommended.rules)
  for (const [name, rule] of Object.entries(oxlintPlugin.rules)) {
    expect(rule).toHaveProperty("createOnce")
    expect(rule).not.toHaveProperty("create")
    expect(eslintPlugin.rules?.[name]).not.toBe(rule)
  }
})

test("recommended Oxlint config resolves the package and enables all rules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operandi-recommended-"))
  try {
    const packageDirectory = join(directory, "node_modules", "operandi")
    await mkdir(packageDirectory, { recursive: true })
    const build = await Bun.build({
      entrypoints: [resolve("src/oxlint.ts")],
      outdir: packageDirectory,
      target: "node",
    })
    expect(build.success).toBe(true)
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "operandi",
        type: "module",
        exports: { "./oxlint": "./oxlint.js" },
      }),
    )
    const config = join(directory, ".oxlintrc.json")
    await writeFile(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        ...oxlintRecommended,
      }),
    )
    const filename = join(directory, "fixture.js")
    for (const [source, expectedCount] of [
      [valid, 0],
      [invalid, 4],
    ] as const) {
      await writeFile(filename, source)
      const result = Bun.spawnSync([
        process.execPath,
        resolve("node_modules/oxlint/bin/oxlint"),
        "-c",
        config,
        "--format",
        "json",
        filename,
      ])
      expect(result.exitCode).toBe(expectedCount ? 1 : 0)
      const diagnostics = JSON.parse(result.stdout.toString()).diagnostics as { code: string }[]
      expect(diagnostics).toHaveLength(expectedCount)
      if (expectedCount) {
        expect(diagnostics.map(({ code }) => code).sort()).toEqual(
          ruleIds.map((id) => id.replace("operandi/", "operandi(") + ")"),
        )
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
