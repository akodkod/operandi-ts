import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const packageName = manifest.name
const archive = resolve(
  process.argv[2] ?? `${packageName.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`,
)
const directory = await mkdtemp(join(tmpdir(), "operandi-package-"))
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(directory, "cache") },
  }).toString()
const write = (dir, file, value) => writeFile(join(dir, file), value)
const fixtures = {
  core: {
    dependencies: {},
    source: `import assert from "node:assert/strict";
import * as api from "operandi-ts";
import { createAction, createActionMiddleware, isOperationResult, StepError } from "operandi-ts";
const success = await createAction().run();
assert.deepEqual(success, { input: undefined, output: undefined });
assert.ok(isOperationResult(success));
assert.ok(isOperationResult(await createAction().runSafe()));
assert.equal(JSON.stringify(success), "{}");
assert.equal("operationResultBrand" in api, false);
assert.equal("createOperationResult" in api, false);
const result = await createAction().step("fail", () => { throw Error("cause"); }).runSafe();
assert.equal(isOperationResult(result), false);
assert.ok(result.error instanceof StepError);
assert.equal(typeof createActionMiddleware, "function");`,
    types: `import { createAction, isOperationResult, type OperationResult, type StandardSchemaV1 } from "operandi-ts";
const schema: StandardSchemaV1<{ value: number }, { value: number }> = {
  "~standard": { version: 1, vendor: "fixture", validate: value => ({value: value as {value: number}}) }
};
const action = createAction().input(schema).output(schema)
  .errors({ BAD: { data: schema } })
  .step("echo", ({ input, setOutput }) => setOutput(input));
const operation = await action.run({ value: 1 });
const input: number = operation.input.value;
const output: number = operation.output.value;
const safe = await action.runSafe({ value: 1 });
if (isOperationResult(safe)) {
  const input: number = safe.input.value;
  const output: number = safe.output.value;
  const error: undefined = safe.error;
}
const unknown: unknown = operation;
if (isOperationResult(unknown)) { const branded: OperationResult<unknown, unknown> = unknown; }
// @ts-expect-error The result brand is required
const unbranded: OperationResult<number, number> = { input: 1, output: 1 };
if (safe.error?.code === "BAD") { const value: number = safe.error.data.value; }
// @ts-expect-error Required input field
await action.run({});
// @ts-expect-error Output retains its number type
const wrong: string = operation.output.value;
// @ts-expect-error After hooks cannot produce data
createAction().afterStep("invalid", () => ({ value: 1 }));
// @ts-expect-error Async after hooks cannot produce data
createAction().afterRun("invalid", async () => ({ value: 1 }));`,
  },
  vite: {
    dependencies: { vite: "6.4.0" },
    source: `import assert from "node:assert/strict";
import { build } from "vite";
import { operandiNames } from "operandi-ts/vite";
const id = "/virtual/actions.ts";
const result = await build({ configFile: false, logLevel: "silent", build: { ssr: id, write: false, rollupOptions: { external: ["operandi-ts"] } }, plugins: [operandiNames(), { name: "fixture", resolveId: s => s === id ? id : null, load: s => s === id ? 'import { createAction } from "operandi-ts"; export const user = createAction();' : null }] });
assert.ok(result.output.some(chunk => chunk.type === "chunk" && chunk.code.includes('createAction("user")')));`,
    types: `import { operandiNames, OperandiNameType } from "operandi-ts/vite";
import type { Plugin } from "vite";
const plugin: Plugin = operandiNames({ transformName: ({ name, type }) => type === OperandiNameType.Action ? name : "middleware:" + name });`,
  },
  eslint: {
    dependencies: { eslint: "10.15.0" },
    source: `import assert from "node:assert/strict";
import { Linter } from "eslint";
import plugin from "operandi-ts/eslint";
const lint = new Linter(); const config = { plugins: { operandi: plugin }, rules: { "operandi/multiline-steps": "error" } };
const prefix = 'import { createAction } from "operandi-ts";';
assert.equal(lint.verify(prefix + 'createAction().step("x", () => {});', config).length, 1);
assert.equal(lint.verify(prefix + 'createAction().step(\\n"x", () => {});', config).length, 0);`,
    types: `import plugin from "operandi-ts/eslint";
import type { ESLint } from "eslint";
const typed: ESLint.Plugin = plugin;`,
  },
  oxlint: {
    dependencies: {},
    source: `import assert from "node:assert/strict";
import plugin from "operandi-ts/oxlint";
assert.equal(typeof plugin.rules["multiline-steps"].createOnce, "function");`,
    types: `import plugin from "operandi-ts/oxlint";
import type { Plugin } from "@oxlint/plugins";
const typed: Plugin = plugin;`,
  },
}

async function packageCount(path) {
  let count = 0
  for (const name of await readdir(path)) {
    if (name.startsWith(".")) continue
    if (name.startsWith("@")) count += (await readdir(join(path, name))).length
    else count++
  }
  return count
}

async function size(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  const sizes = await Promise.all((await readdir(path)).map((name) => size(join(path, name))))
  return sizes.reduce((sum, bytes) => sum + bytes, 0)
}

try {
  const results = []
  for (const [name, fixture] of Object.entries(fixtures)) {
    const cwd = join(directory, name)
    await mkdir(cwd)
    await write(
      cwd,
      "package.json",
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { [packageName]: `file:${archive}`, ...fixture.dependencies },
      }),
    )
    run("bun", ["install", "--production", "--ignore-scripts"], cwd)
    await write(cwd, "smoke.mjs", fixture.source.replaceAll("operandi-ts", packageName))
    run("node", ["smoke.mjs"], cwd)
    const manifest = JSON.parse(
      await readFile(join(cwd, `node_modules/${packageName}/package.json`), "utf8"),
    )
    assert.deepEqual(Object.keys(manifest.exports).sort(), [".", "./eslint", "./oxlint", "./vite"])
    results.push({
      name,
      bytes: await size(join(cwd, "node_modules")),
      packages: await packageCount(join(cwd, "node_modules")),
    })
    await write(cwd, "check.mts", fixture.types.replaceAll("operandi-ts", packageName))
  }
  const compiler = join(directory, "compiler")
  await mkdir(compiler)
  await write(
    compiler,
    "package.json",
    JSON.stringify({
      private: true,
      dependencies: { typescript: "7.0.2", "@types/node": "26.6.6" },
    }),
  )
  run("bun", ["install", "--ignore-scripts"], compiler)
  for (const name of Object.keys(fixtures)) {
    const cwd = join(directory, name)
    run(
      join(compiler, "node_modules/.bin/tsc"),
      [
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--typeRoots",
        join(compiler, "node_modules/@types"),
        "check.mts",
      ],
      cwd,
    )
  }
  console.log(
    JSON.stringify(
      {
        directory,
        node: process.version,
        bun: run("bun", ["--version"], directory).trim(),
        archiveBytes: (await stat(archive)).size,
        results,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(`Consumer fixtures retained at ${directory}`)
  if (error.stdout) console.error(error.stdout.toString())
  if (error.stderr) console.error(error.stderr.toString())
  throw error
}
