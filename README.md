# Operandi

Type-safe business logic in named, sequential steps. Supports Zod, Valibot,
ArkType, and other Standard Schema v1 validators, including async validation.

## Table of contents

- [Action factories and lifecycle hooks](#action-factories-and-lifecycle-hooks)
- [Middleware](#middleware)
- [Typed errors and safe execution](#typed-errors-and-safe-execution)
- [Automatic names with Vite](#automatic-names-with-vite)
- [Lint rules](#lint-rules)
  - [Recommended configuration](#recommended-configuration)
  - [`operandi/multiline-steps`](#operandimultiline-steps)
  - [`operandi/multiline-schema`](#operandimultiline-schema)
  - [`operandi/step-name-starts-with-lowercase`](#operandistep-name-starts-with-lowercase)
  - [`operandi/static-action-declaration`](#operandistatic-action-declaration)
- [Development](#development)
  - [Source architecture](#source-architecture)

```sh
bun add operandi zod
# or: npm install operandi zod
```

```typescript
import { createAction, createActionMiddleware } from "operandi"
import { z } from "zod"

// requireWorkspace and db are your application's dependencies.
const completeGitHubAuthentication = createAction()
  .input(
    z.object({
      userId: z.int(),
      workspaceId: z.int(),
    }),
  )
  .output(
    z.object({
      success: z.boolean(),
    }),
  )
  .step("validate workspace", async ({ input }) => {
    await requireWorkspace(input.userId, input.workspaceId)
  })
  .step("open transaction", async () => {
    const tx = await db.startTransaction()
    return { tx }
  })
  .step("complete", async ({ input, data }) => {
    await data.tx.update(input.userId)
  })
  .step("commit transaction", async ({ data, setOutput }) => {
    await data.tx.commit()
    setOutput({ success: true })
  })

const operation = await completeGitHubAuthentication.run({
  userId: 1,
  workspaceId: 2,
})

operation.input // { userId: number; workspaceId: number }
operation.output // { success: boolean }
```

Configure `.input(schema)`, then optionally `.output(schema)`, before adding
steps. Both schemas are optional. An operation without an input schema runs with
`.run()`. Awaiting `.run()` returns an `OperationResult<Input, Output>` with
readonly `input` and `output` properties. Without an input schema, `input` is
`undefined`; without an output schema, `output` is `undefined` (unless middleware
provides it).

Each step receives validated `input`, accumulated `data`, and (when an output
schema exists) a typed `setOutput`. Steps can be synchronous or asynchronous and
return a plain object or nothing. Returned properties are shallowly merged into
`data` for subsequent steps; later properties replace earlier ones. The types
follow these changes, including optional properties and conditional returns.
The data container is shallowly frozen; nested resources such as transactions
remain usable. Return properties to update data.

`setOutput(value)` replaces the entire output value; it does not stop execution.
After all steps finish, the output schema validates and transforms the last value.
If no step sets output, the schema receives `undefined`: defaults can supply a
value, otherwise required output validation fails. Call and await work using
`setOutput` within its step, before that step finishes.

Schema transformations are reflected in types: `.run()` takes the input schema's
raw input, steps see its parsed output, `setOutput` takes the output schema's raw
input. The completed result exposes parsed input as `result.input` and parsed
output as `result.output`.

```typescript
const double = createAction()
  .input(z.string().transform(Number))
  .output(z.number().transform(String))
  .step("double", ({ input, setOutput }) => setOutput(input * 2))

const operation = await double.run("21")
operation.input // 21 (number)
operation.output // "42" (string)
```

`.run()` resolves only after all steps and output validation succeed. Failures
still reject the promise; use `.runSafe()` to receive failures as values. To migrate from the
previous output-only return value, use `const { output } = await action.run(...)`.

Builders are immutable: extending an operation creates a new operation. Each run
gets separate data and output storage, so an operation can be reused concurrently.
Objects captured by your callbacks are still shared by your application.

Failures stop execution. Schema issues throw `ValidationError` with `phase`
(`"input"`, `"output"`, or `"error"`) and the original `issues`. Unexpected step failures throw
`StepError` with `stepName`, zero-based `stepIndex`, and the original `cause`.
Exceptions thrown by a validator itself propagate unchanged. The runner does not
roll back side effects or manage transaction lifetimes; use your database's
transaction wrapper or explicit error handling for rollback.

```typescript
import { StepError, ValidationError } from "operandi"

try {
  await completeGitHubAuthentication.run({ userId: 1, workspaceId: 2 })
} catch (error) {
  if (error instanceof StepError) {
    console.error(error.stepName, error.cause)
  } else if (error instanceof ValidationError) {
    console.error(error.phase, error.issues)
  } else {
    throw error
  }
}
```

## Action factories and lifecycle hooks

Create independent builders with `createAction(actionName?)` or
`createActionMiddleware(middlewareName?)`. Names are optional and are available
in hook contexts. These factories replace the previous `operandi` singleton.

```typescript
const completeGitHubAuthentication = createAction("Complete GitHub Authentication")
  .beforeRun("track start time", () => ({ startTime: Date.now() }))
  .afterRun("track duration", ({ actionName, data }) => {
    const duration = Date.now() - data.startTime
    console.log(actionName, duration)
  })
  .aroundRun("trace action", async ({ actionName, run }) => {
    await tracer.startActiveSpan(`Run: ${actionName}`, async (span) => {
      try {
        await run()
      } finally {
        span.end()
      }
    })
  })
  .beforeStep("track step start", () => ({ stepStartTime: Date.now() }))
  .afterStep("track step duration", ({ stepName, data }) => {
    console.log(stepName, Date.now() - data.stepStartTime)
  })
  .aroundStep("trace step", async ({ stepName, runStep }) => {
    await tracer.startActiveSpan(`Step: ${stepName}`, async (span) => {
      try {
        await runStep()
      } finally {
        span.end()
      }
    })
  })
  .step("authenticate", async ({ data }) => {
    await authenticate() // Your application's work.
    console.log(data.startTime)
  })

await completeGitHubAuthentication.run()
```

| Hook         | Runs                                                                  | Return value                     |
| ------------ | --------------------------------------------------------------------- | -------------------------------- |
| `beforeRun`  | Once before middleware and local steps                                | Object merged into data, or void |
| `afterRun`   | After successful middleware and local steps, before output validation | Void only                        |
| `aroundRun`  | Wraps the full execution after input validation                       | Void; call `await run()`         |
| `beforeStep` | Before every local step                                               | Object merged into data, or void |
| `afterStep`  | After each successful local step                                      | Void only                        |
| `aroundStep` | Wraps each local step and its before/after hooks                      | Void; call `await runStep()`     |

All hooks accept a name and a synchronous or asynchronous callback. After hooks
accept only `void` or `Promise<void>`; returning an object is both a type error and
a runtime error. Hooks do not change the `{ input, output }` result shape.

Input validation happens first. Then execution proceeds as follows:

1. Enter middleware `aroundRun` wrappers in `.use()` order, recursively entering
   nested middleware before its parent. Then enter the action's `aroundRun` wrappers.
   Within each builder, the first registered wrapper is outermost.
2. Run `beforeRun` hooks in registration order.
3. Execute middleware with its own hooks and steps.
4. For each local step: enter `aroundStep`, run `beforeStep`, execute the step,
   run `afterStep`, and exit `aroundStep`.
5. Run `afterRun` hooks, validate output, and exit all `aroundRun` wrappers in
   reverse order.

The same lifecycle applies to `.run()` and `.runSafe()`. After hooks only run on
success. Use `try/finally` in an around hook for cleanup on failure. Continuations
must be called exactly once while their hook is active; the runner waits for the
continuation and propagates its failures even if a wrapper catches them. Around
hooks cannot skip steps, retry execution, or set output.

Hook contexts include `actionName`, `middlewareName`, validated `input`, `data`,
and typed `errors`. Before/after hooks also receive `setOutput` when an output
schema has been configured. Step hooks additionally receive `stepName` and
zero-based `stepIndex`. An unnamed action has `actionName: undefined`.
Middleware hooks receive the consuming action's name and their own middleware
name. Middleware `aroundRun` hooks wrap the entire consuming action, including
its hooks, sibling middleware, and output validation. This lets transaction and
request-context middleware stay active until the action finishes. Other middleware
hooks remain local to that middleware. All hook contexts retain their own builder's
input and data; middleware wrappers do not receive the consuming action's data.

For example, a transaction wrapper can be a reusable middleware constant:

```typescript
const WithTransaction = createActionMiddleware("With Transaction")
  .aroundRun("run in transaction", async ({ run }) => {
    await db.transaction((tx) => transactionContext.run(tx, run))
  })
  .beforeRun("use transaction", () => ({ tx: transactionContext.getStore()! }))

const SaveRecord = createAction("Save Record")
  .use(WithTransaction)
  .step("save record", async ({ data }) => {
    await saveRecord(data.tx)
  })
```

`db`, `transactionContext`, and `saveRecord` above are application-provided. A
transaction callback must await `run()` and let failures propagate to roll back.
This changes the earlier middleware-local scope of `aroundRun`: cleanup and commit
code after `await run()` now runs after the consuming action finishes.

Register `beforeRun`, `beforeStep`, `afterStep`, and `aroundStep` before the first
step. `afterRun` and `aroundRun` can also be registered after steps. A hook's
context is inferred from what has already been declared: a final `afterRun`
registered after steps can read their returned data. `beforeRun` can only rely
on preceding `beforeRun` data; middleware has not executed yet. `afterStep` can
rely on setup data and `beforeStep` data; arbitrary per-step return values are
not part of its static contract. Around-hook data is partial because execution
has not happened yet; reading `context.data` again after the continuation gives
the current data snapshot.

For actions with hooks, each data field belongs to the step or hook that first
produced it. Other producers cannot overwrite it, preventing previously typed
hook contexts from becoming invalid. A `beforeStep` hook can refresh its own
fields for every step. Use distinct names for setup, step, and middleware data.
Actions without hooks retain their existing last-write-wins merge behavior.

## Middleware

Use `createActionMiddleware(middlewareName?)` to define reusable middleware. Its schemas, steps, and returned data
become part of the consuming action:

```typescript
const withUser = createActionMiddleware("Require user")
  .input(
    z.object({
      userId: z.number(),
    }),
  )
  .output(
    z.object({
      authenticated: z.boolean(),
    }),
  )
  .step("require user", async ({ input, setOutput }) => {
    const user = await requireUser(input.userId) // Your application's lookup.
    setOutput({ authenticated: true })
    return { user }
  })

const action = createAction()
  .use(withUser)
  .input(
    z.object({
      message: z.string(),
    }),
  )
  .output(
    z.object({
      success: z.boolean(),
    }),
  )
  .step("my step", ({ input, data, setOutput }) => {
    console.log(`${input.userId}: ${input.message}`, data.user)
    setOutput({ success: true })
  })

const operation = await action.run({ userId: 1, message: "Hello" })
operation.input // { userId: 1, message: "Hello" }
operation.output // { authenticated: true, success: true }

// Type error: userId is required by withUser.
// await action.run({ message: "Hello" });
```

A middleware can also contain only an input schema:

```typescript
const withUserId = createActionMiddleware("Require user ID").input(
  z.object({
    userId: z.number(),
  }),
)
const action = createAction()
  .use(withUserId)
  .input(
    z.object({
      message: z.string(),
    }),
  )
await action.run({ userId: 1, message: "Hello" })
```

Call `.use()` before local schemas and steps. You can chain multiple `.use()`
calls and use middleware that itself uses middleware. Only builders created with
`createActionMiddleware()` can be passed to `.use()`. Input and output schemas
used in middleware must describe objects; standalone operations still support
scalar schemas.

All input schemas validate the same raw argument before any steps run. Each
middleware sees its own parsed input (including its nested middleware), while the
consuming action sees their shallowly merged parsed inputs. Schemas that reject
unknown keys must allow the other schemas' fields in that shared argument.
Overlapping raw fields must satisfy every schema. Parsed field collisions use
last-write wins: middleware in registration order, followed by the local schema.
This also applies to merged data and output.

Middleware executes in registration order, before local steps. Each middleware
has its own data and output storage; its final data is merged into the action's
initial data. A sibling middleware does not receive another sibling's data.
Each `setOutput` accepts only its own operation's output schema input. Middleware
output is validated and transformed before local steps run; `result.output`
merges these validated outputs with the action's validated output. If you omit a
local output schema, `result.output` contains the merged middleware output.
`result.input` contains the merged parsed input seen by the action's steps.

Any middleware validation or step failure stops execution. Operations remain
immutable and reusable across actions and concurrent runs. `.use()` composes
operations as prerequisites; it does not provide a `next()` callback or an
around-execution hook.

## Typed errors and safe execution

Declare application errors with `.errors()` and throw them using the step's
`errors` factories. This follows the
[oRPC declared-error pattern](https://orpc.dev/docs/error-handling).

```typescript
const action = createAction()
  .errors({
    NotFound: {
      message: "User not found",
      data: z.object({ userId: z.number() }),
    },
    Forbidden: { message: "Access denied" },
  })
  .input(
    z.object({
      userId: z.number(),
    }),
  )
  .output(
    z.object({
      name: z.string(),
    }),
  )
  .step("find user", async ({ input, errors, setOutput }) => {
    const user = await findUser(input.userId) // Your application's lookup.
    if (!user) {
      throw errors.NotFound({ data: { userId: input.userId } })
    }
    if (!user.active) throw errors.Forbidden()
    setOutput({ name: user.name })
  })

// Throws OperandiError directly for declared failures.
const result = await action.run({ userId: 1 })
result.output.name

// Captures failures instead of rejecting.
const operation = await action.runSafe({ userId: 1 })
if (operation.error) {
  if (operation.error.code === "NotFound") {
    console.log(operation.error.data.userId) // number
  } else {
    console.error(operation.error.message)
  }
} else {
  console.log(operation.input.userId, operation.output.name)
}
```

`runSafe` returns a `SafeOperationResult<Input, Output, Errors>` union. Checking
`operation.error` narrows the result:

- Success: `error` is `undefined`; `input` and `output` have their validated types.
- Failure: `error` contains the failure; `output` is `undefined`. `input` contains
  the parsed, merged input if all input validation completed, otherwise `undefined`.
  Partial input or output is never returned.

The factories infer their required `data` from the schema's input type. Data is
validated and transformed when the error is thrown out of a step, including
async Standard Schema validation. Safe results expose the schema's output type.
Invalid error data produces `ValidationError` with `phase: "error"`, rather than
an incorrectly typed application error. Calling a factory constructs an error;
it does not interrupt execution until you throw it.

Factory options accept `message` and `cause` overrides. Without an override, the
message uses the definition's message, then the error code. Without a data schema,
error data is `undefined`. You can also throw
`new OperandiError("NotFound", { userId: 1 }, { cause })` from a utility: a matching
declaration on the throwing step validates it in the same way.

Declare errors before the steps that use them. `.errors()` preserves the current
builder stage, so it can appear before or after `.input()` and `.output()`, or
between steps. Existing steps retain their original declarations. Middleware
error declarations are automatically included in the action's factories and
safe-result error union. Duplicate codes throw during builder configuration,
including duplicates across middleware; use distinct codes for distinct payloads.
Use inferred literals (or `satisfies ErrorMap`) when sharing definitions to preserve
precise payload types.

Declared errors are `OperandiError` instances with `code`, `message`, `data`, and
`cause`. They pass through `.run()` without a `StepError` wrapper. TypeScript does
not type thrown exceptions; use `.runSafe()` for code-based payload narrowing.
Other failure types have `code: undefined`:

- `ValidationError`: invalid input, output, or declared-error data.
- `StepError`: unexpected exceptions from steps, including undeclared
  `OperandiError` codes; preserves the original exception in `cause`.
- `HookError`: unexpected hook failures, with `phase`, `hookName`, `actionName`,
  optional `stepName`, and the original `cause`.
- `UnexpectedError`: `.runSafe()` wraps other failures, such as exceptions thrown
  by schema validators, preserving them in `cause`. `.run()` still throws those
  original failures unchanged.

Failures stop subsequent steps. Neither execution method rolls back side effects.
`.run()` keeps its existing `{ input, output }` success shape; only `.runSafe()`
adds the `error` property.

## Automatic names with Vite

Enable `operandiNames` to infer action and middleware names from their variable
names, including calls followed by builder methods:

```typescript
import { defineConfig } from "vite"
import { operandiNames } from "operandi/vite"

export default defineConfig({
  plugins: [operandiNames()],
})
```

```typescript
const createUser = createAction().input(userSchema)
const authenticate = createActionMiddleware()
// Compiled as createAction("createUser") and createActionMiddleware("authenticate").
```

Customize inferred names with `transformName`. The callback runs during source
transformation and must return a string. The exported `OperandiNameType` enum
provides `Action = "action"` and `Middleware = "middleware"` for `type`:

```typescript
operandiNames({
  transformName: ({ name, type }) => `${type}: ${name}`,
})
```

Explicit arguments are preserved. Named imports from `operandi`, including
aliases, are recognized; locally shadowed functions are ignored. Inference applies
to simple variable declarations in JavaScript and TypeScript files, including
JSX/TSX, processed by Vite in development or production. Anonymous exports,
destructuring, wrapper functions, and namespace imports are not inferred.
Direct Node or `bun test` execution does not run this plugin. Use explicit names
when running outside Vite or when a name must survive a variable rename.

## Lint rules

The optional `operandi/oxlint` entry point uses Oxlint’s `createOnce` JavaScript
plugin API. `operandi/eslint` adapts the same rules for ESLint 9+. Neither
entry point enables rules automatically. The Oxlint entry point requires no
ESLint installation; it is a JavaScript plugin, not a compiled Rust rule.

### Recommended configuration

Both entry points export `recommended`, also available as
`operandi.configs.recommended` on their default plugin export. Each preset enables
all four rules at error severity with their default options. The recommended
step-name ignore list is empty; add your own exceptions when needed.

For ESLint flat config:

```javascript
import { recommended } from "operandi/eslint"

export default [recommended]
```

The preset registers the plugin. Keep your existing TypeScript parser and file
matching configuration for TypeScript projects. To override a rule, place a
configuration after the preset:

```javascript
import { recommended } from "operandi/eslint"

export default [
  recommended,
  {
    rules: {
      "operandi/step-name-starts-with-lowercase": ["error", { ignore: ["API", "GraphQL"] }],
    },
  },
]
```

For an Oxlint JavaScript or TypeScript config:

```typescript
import { recommended } from "operandi/oxlint"

export default recommended
```

For Vite+, use `defineConfig({ lint: recommended })`. The Oxlint preset includes
`jsPlugins` and `rules`; spread it into an existing config and merge any existing
plugin registrations and rule overrides. JSON-only configurations can use the
explicit rule settings shown below.

### `operandi/multiline-steps`

Requires Operandi `.step(...)`, `.beforeRun(...)`, `.afterRun(...)`,
`.aroundRun(...)`, `.beforeStep(...)`, `.afterStep(...)`, and `.aroundStep(...)`
calls to span multiple lines, measured from the method name to its closing parenthesis. A newline earlier in the chain does not count.
A multiline callback or multiline argument list satisfies the rule:

```typescript
// Reported:
createAction().step("save", ({ input }) => save(input))
createAction().beforeRun("start", () => start())

// Allowed:
createAction().step("save", ({ input }) => {
  return save(input)
})

createAction().step("save", (context) => {
  return saveStep(context)
})
```

The rule recognizes `createAction` and `createActionMiddleware` imported from
`operandi`, including renamed imports, namespace imports, and local `const`
aliases/builders. It ignores unrelated methods and shadowed bindings.
It does not resolve builders across files, mutable variables, or custom factory
wrappers. The optional `importSources` array replaces the default `["operandi"]`
when factories are imported through another entry point. This repo uses
`{ "importSources": ["operandi", "../src/index"] }` to lint its source-based tests.
The rule reports violations without autofixing.
Schema and composition calls (`input`, `output`, `errors`, and `use`) are unaffected.

### `operandi/multiline-schema`

When an inline Zod object schema passed to Operandi `.input()` or `.output()` has
more than one property, `z.object` must start on a new line, with each property
and the closing braces on separate lines. The outer call's closing parenthesis
also goes on its own line. Empty and single-property schemas may stay inline:

```typescript
createAction()
  .input(
    z.object({
      userId: z.string(),
      workspaceId: z.string(),
    }),
  )
  .output(z.object({ success: z.boolean() }))
```

The rule recognizes Zod named, renamed, default, and namespace imports from
`zod`, `zod/v4`, `zod/mini`, and `zod/v4/mini`. It also checks chained schemas such
as `z.object({ ... }).strict()`. Other validators, unrelated `.input()`/`.output()`
methods, shadowed imports, and schemas passed by variable are unaffected.
Only entries in the immediate object literal are counted; each spread counts as
one entry. Nested properties and shapes passed by variable are not expanded.
It supports the same `importSources` option as `multiline-steps` and reports
violations without autofixing.

### `operandi/step-name-starts-with-lowercase`

Requires `.step()` names to begin with a lowercase letter, including Unicode
lowercase letters. The optional `ignore` list permits specific opening words:

```json
"operandi/step-name-starts-with-lowercase": ["error", {
  "ignore": ["API", "GraphQL"]
}]
```

With that configuration, `"fetch user"`, `"API request"`, and `"GraphQL query"`
are allowed; `"Fetch user"` and `"APIClient request"` are reported. Matching is
case-sensitive and uses the entire opening word (letters, combining marks,
digits, and underscores). Punctuation can follow an ignored word, so
`"API: request"` and `"API-request"` are allowed. The default ignore list is empty.

The rule checks string literals and template literals without interpolations.
Dynamic names, including variables and interpolated templates, are not evaluated.
It checks actions and middleware, supports the same `importSources` option as the
other rules, and ignores unrelated or shadowed builders. Lifecycle hook names are
unaffected. It reports violations without automatically changing names.

### `operandi/static-action-declaration`

Requires `createAction()` and its fluent builder chain to directly initialize a
named, module-level `const`. Define the action once, then call `.run()` or
`.runSafe()` wherever needed:

```typescript
export const saveUser = createAction().step("save user", async () => {
  await save()
})

async function handleRequest() {
  return saveUser.run()
}
```

Calls inside functions, callbacks, loops, conditional blocks, and class bodies
are reported, even when assigned to a local `const`. The rule also rejects
`let`/`var`, unassigned calls, destructuring, inline execution such as
`const result = createAction().run()`, and actions nested inside object literals,
arrays, conditionals, or other calls. Export a named constant instead of writing
`export default createAction()`.

It recognizes renamed and namespace imports, local `const` factory aliases, and
TypeScript wrappers. It supports the same `importSources` option as the other
rules and ignores unrelated or shadowed factories. `createActionMiddleware()`
is unaffected. There is no automatic fix because moving a declaration can change
its scope and captured values.

For ESLint flat config, add the plugin to your existing configuration (and keep
your TypeScript parser configuration when linting TypeScript):

```javascript
import operandi from "operandi/eslint"

export default [
  {
    plugins: { operandi },
    rules: {
      "operandi/multiline-steps": "error",
      "operandi/multiline-schema": "error",
      "operandi/step-name-starts-with-lowercase": ["error", { ignore: ["API", "GraphQL"] }],
      "operandi/static-action-declaration": "error",
    },
  },
]
```

For Oxlint, add this to `.oxlintrc.json`:

```json
{
  "jsPlugins": [{ "name": "operandi", "specifier": "operandi/oxlint" }],
  "rules": {
    "operandi/multiline-steps": "error",
    "operandi/multiline-schema": "error",
    "operandi/step-name-starts-with-lowercase": ["error", { "ignore": ["API", "GraphQL"] }],
    "operandi/static-action-declaration": "error"
  }
}
```

For Vite+, use the same `jsPlugins` and `rules` fields inside `lint` in
`vite.config.ts`. Oxlint loads the plugin through its
[`createOnce` JavaScript plugin API](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins).

## Development

Uses Bun 1.4.4+ and Vite+. Bun supplies native type checking, formatting, and tests;
Vite+ supplies linting and ESM packaging with TypeScript declarations.

```sh
bun install --frozen-lockfile
bun fmt
bun fmt --check
bun check
bun test
bun run test:coverage
bun run lint
bun run build
bun pm pack
```

GitHub Actions runs formatting, type checking, lint, tests, and the build on pushes
and pull requests. Open the CI run summary for test results and per-file line and
function coverage; download its `coverage` artifact for the LCOV report and test
log. A separate job converts LCOV to Cobertura and publishes it through
[`actions/upload-code-coverage`](https://github.com/actions/upload-code-coverage)
using the built-in GitHub token with `code-quality: write` permission. PR runs test
the head commit so coverage matches the commit uploaded to GitHub. Fork PRs still
run checks and retain coverage artifacts, but GitHub skips their coverage upload.
Coverage excludes subprocess execution (including Oxlint integration tests).
No external coverage service or token is required.

`tests/types.ts` contains positive and negative compile-time assertions checked
by `bun check`; runtime tests cover execution, validation, schema interoperability,
transformations, failures, branching, and concurrent runs. The core entry has no external runtime imports. `@standard-schema/spec` provides
the public schema types. The Vite plugin imports Babel and MagicString at runtime;
the ESLint adapter uses `@oxlint/plugins` at runtime and exposes types from its
optional ESLint peer. Oxlint types also reference `@oxlint/plugins`.

Formatting uses Bun with `bunfig.toml` (no semicolons, 100-column width).
Repo lint loads `src/oxlint.ts` directly and enables all four rules, with `API`
and `GraphQL` allowed as opening words in step names. No build is needed before
linting. Use block-bodied step callbacks so Bun preserves
their multiline layout. The repo disables `static-action-declaration` for
`tests/**/*.ts`: runtime tests construct isolated actions inside test callbacks,
and type tests deliberately exercise invalid expressions. Dedicated lint tests
check the rule with both ESLint and Oxlint.
Bun owns indentation, member delimiters, wrapping, and vertical spacing; conflicting
lint presentation rules are disabled. Native TypeScript-aware unused-variable
checks replace the JavaScript plugin check on type signatures. Test-only async
fixtures and Bun promise assertions have scoped lint exceptions; the builder
types intentionally use `void` and an empty merge identity.

### Source architecture

`src/index.ts` is the explicit public export list. `types.ts` owns fluent builder
inference and callback/result contracts; `errors.ts` owns error classes and their
type contracts. `builder.ts` creates immutable definitions and implements the
public run methods.

The runtime modules separate input preparation and validation, record merging,
error factories, lifecycle orchestration (`execute.ts`), and callback/continuation
execution (`invoke.ts`). Runtime modules do not import the public entry point.
Vite, ESLint, and Oxlint integrations retain independent entry points.

Each lint rule lives in its own file under `src/oxlint/`. `shared.ts` owns AST and
import-binding helpers, and `recommended.ts` defines the shared recommended rule
settings. `src/oxlint.ts` registers the native rules and Oxlint preset;
`src/eslint.ts` adapts copies of those rules and registers the ESLint flat preset.

After building and packing, run `bun run check:package` to install the tarball in
isolated temporary consumers and verify Node imports and strict NodeNext types.
This release check requires registry access and retains its fixture directory for
inspection. It reports production install sizes before adding any compiler tools.
