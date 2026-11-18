# Plan 002: Split the core into modules without changing behavior

- **Priority:** P1
- **Effort:** M
- **Risk:** MED; declarations, error constructor identity, and imports must remain stable
- **Depends on:** 001-verification-baseline.md
- **Category:** tech-debt
- **Confidence:** HIGH

## Execution contract

Read the entire plan before changing files. Update only this plan's status row in `plans/README.md` after execution and review. Do not publish, commit, push, initialize Git, or install new tooling merely to execute this plan.

**Planned at:** 2026-11-18; commit unavailable (`git rev-parse --short HEAD` reports no Git repository). Workspace: `/Users/kodkod/Developer/Kodkod/operandi-ts`.

**Drift check:** run `shasum -a 256 -c plans/baseline.sha256`. This captures the reviewed source, tests, manifest, lockfile, and configuration. Before plan 001 all entries should match. Later plans expect changes from their completed prerequisites: compare mismatches with those plans' completion notes and the excerpts below. Stop on unexplained changes; whitespace changes alone from plan 001 are expected. Do not overwrite unrelated user work. No branch or commit convention could be established because this workspace is not a Git repository.

## Verification commands

Run from the repository root, with its existing Bun 1.4.4+ and installed dependencies:

| Purpose               | Command                | Expected result                                                                                                                |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Type checking         | `bun check`            | Exit 0, no type errors, including `tests/types.ts`                                                                             |
| Runtime coverage      | `bun test`             | Exit 0; baseline 64 tests across six files, no removed tests                                                                   |
| Lint                  | `bun run lint`         | Currently fails; must pass after plan 001                                                                                      |
| CI lint configuration | `CI=true bun run lint` | Must pass after plan 001                                                                                                       |
| ESM/declarations      | `bun run build`        | Exit 0; `dist/index.mjs`, `dist/index.d.mts`, `dist/vite.mjs`, `dist/vite.d.mts`, `dist/eslint.mjs`, `dist/eslint.d.mts` exist |
| Distribution          | `bun pm pack`          | Exit 0; package includes all three entry points and their referenced files                                                     |

The advisor ran type checking and runtime tests successfully and observed lint failure. Build/pack are executor gates, not claims of verification during this read-only audit. Build output belongs in ignored `dist/`; tarballs are also ignored. Do not install unless dependencies are absent; use `bun install --frozen-lockfile` in that case (plan 004 explicitly permits a manifest/lockfile update).

## Shared behavioral constraints

This is an ESM TypeScript package with three entry points: `operandi`, `operandi/vite`, and `operandi/eslint`. Keep all three and all currently exported names. Builders are immutable; runs have isolated state. All input schemas validate before effects. Middleware runs in its own scope, then contributes parsed input, data, and output. Preserve registration-time error declarations and declared error data validation. `.run()` returns `{ input, output }` or throws; `.runSafe()` captures typed failures with `output: undefined`. Both `afterRun` and `afterStep` accept only void/Promise-like void and reject non-undefined runtime returns. Around hooks must execute their continuation exactly once, cannot set output, and cannot hide continuation failures. Keep data ownership restrictions for hooked actions and last-write-wins for unhooked actions. These are documented contracts, not refactoring opportunities.

## General STOP conditions

Stop and report if unexplained drift appears, a verification gate still fails after two focused attempts, an out-of-scope edit becomes necessary, or preserving the public API requires weakening types or deleting assertions. Do not relax `strict`, `exactOptionalPropertyTypes`, or `noUncheckedIndexedAccess`. Do not remove tests to obtain a green result.

## Why this matters

`src/index.ts` is 690 lines and mixes type inference, error classes, configuration, validation, and execution. Extract cohesive modules first, leaving algorithms intact. This creates a readable base for later invocation simplification without mixing structural and semantic changes.

## Current state

`src/index.ts` contains these boundaries (line numbers precede plan 001):

- Lines 1–290: public contracts and builder inference, including `declare const actionState: unique symbol` and `ActionBuilder<State extends ActionState>`.
- Lines 53–71 and 292–327: five public error classes, interspersed with types.
- Lines 329–391: runtime contracts, validation, plain-object composition, and input preparation.
- Lines 393–571: `execute`, containing nested `mergeData`, `failure`, `invoke`, `hooks`, and `around` functions.
- Lines 573–596: duplicate-code checks and error factories.
- Lines 598–690: immutable builder creation and exported factories.

Load-bearing excerpts:

```ts
const definitions = new WeakMap<object, Definition>()
// Builder runtime erases public generic state at this one boundary:
return operation as unknown as Action
```

```ts
const result = await schema["~standard"].validate(value)
if (result.issues) throw new ValidationError(phase, result.issues)
return result.value
```

`vite.config.ts` builds `entry: ["src/index.ts", "src/vite.ts", "src/eslint.ts"]`, with ESM, declarations, and source maps. Existing tests import `../src/index`; preserve that import boundary. Public `StandardSchemaV1` is a type re-export.

## Scope

In scope: `src/index.ts`, new `src/types.ts`, `src/errors.ts`, `src/builder.ts`, `src/runtime/definition.ts`, `src/runtime/validation.ts`, `src/runtime/records.ts`, `src/runtime/error-factories.ts`, `src/runtime/execute.ts`, `tests/public-api.test.ts`, `tests/types.ts` only for public export checks, `README.md` for a concise architecture description, and plan/index completion notes.

Out of scope: plugin implementation, dependency manifest/lockfile, build settings, lifecycle algorithms, generic inference redesign. Do not create a general `utils.ts` or export internals from the root.

## Steps

### 1. Record the public boundary

Add `tests/public-api.test.ts` that imports the source root as a namespace and checks the exact runtime exports: `createAction`, `createActionMiddleware`, `OperandiError`, `UnexpectedError`, `ValidationError`, `StepError`, `HookError`. Follow Bun `test`/`expect` conventions from `tests/hooks.test.ts`. Capture the currently exported type names with `rg -n '^export' src/index.ts`; keep their names and generic defaults. Build once and record declaration/export output in a temporary directory for comparison.

**Verify:** `bun test tests/public-api.test.ts`, `bun check`, and `bun run build` exit 0 before extraction.

### 2. Extract the leaf contracts and helpers

Move public error classes and error contracts into `errors.ts`; use type-only imports for any dependency on `HookPhase`. Move public contexts/results/builder inference into `types.ts` unchanged, including the private unique-symbol brand and metadata-only `.use()` inference. Expose internal-only type names to sibling modules as necessary, but do not re-export them from `index.ts`.

Move `Definition`, `Prepared`, `Step`, `Hook`, and erased runtime context types into `runtime/definition.ts`. Put `isRecord` and `combine` into `runtime/records.ts`, `validate` and `prepare` into `runtime/validation.ts`, and `mergeErrors`/`createErrorFactories` into `runtime/error-factories.ts`. Use explicit `import type` for type-only dependencies. Keep all five error classes defined once so `instanceof` continues to work.

**Verify after each extraction:** `bun check` and `bun test` exit 0. `bun run lint` exits 0 once imports are settled. No internal module imports `src/index.ts`.

### 3. Move the builder and orchestration

Move `execute` and its nested functions together into `runtime/execute.ts` unchanged. Keep `definitions` private in `builder.ts`, alongside `create`, `createAction`, and `createActionMiddleware`. Keep run/runSafe result assembly and normalization in the builder for now. Make `index.ts` explicit named value/type re-exports only. Do not flatten the recursion, cache error factories, or change context construction in this plan.

Dependency direction: root exports builder/errors/types; builder calls runtime preparation/execution; runtime depends on leaf errors/contracts/records; leaf runtime modules never import the builder or root. Type-only cycles between contracts are acceptable if unavoidable; avoid runtime cycles entirely.

**Verify:** `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, and `bun run build` exit 0. `rg -n '^(async )?function |^export (async )?function |^export class ' src/index.ts` returns no matches (exit 1 is expected).

### 4. Verify the built entry and describe the architecture

Run `bun pm pack`; inspect the tarball to confirm every referenced local module/declaration is included. Test the built root with Node: `node --input-type=module -e 'import("./dist/index.mjs").then(async m => { const r = await m.createAction().run(); if (r.input !== undefined || r.output !== undefined) throw Error("bad result"); })'`. Compare exported names against the source test and compare declaration signatures against the baseline, allowing module relocation but no API changes. Add a short module ownership description to README.

**Verify:** Node smoke exits 0; all common gates pass. The tarball contains all three existing entry points. Record the final module inventory and any nonsemantic declaration layout changes in completion notes.

## Test plan

Add only the root export regression test; rely on existing behavior and type tests to characterize this extraction. Compile-time export checks must import through `src/index`, not internal modules. Preserve middleware/error/hook tests unchanged except formatting already handled in plan 001.

## Done criteria

- [x] Root contains explicit exports only; no implementation functions/classes.
- [x] Exact seven runtime exports remain, and all public type exports remain accessible.
- [x] At least 65 runtime tests pass, including the export regression test.
- [x] Type checking, both lint modes, build, Node smoke, and pack pass.
- [x] No runtime cycles or internal imports through the public barrel.
- [x] No generic simplification, algorithm changes, or new runtime dependencies.
- [x] Index and completion notes updated.

## Specific STOP conditions

Stop if exported types lose inference or require adding public generic parameters, the unique-symbol metadata forces a runtime import, or package declarations reference unpublished files. Do not solve these by exporting all internals or weakening types.

## Maintenance notes

Use the module ownership boundaries for future changes; keep the public export list explicit. Public types describe the fluent state machine while runtime storage intentionally erases that state. The cast at builder creation is an intentional boundary, not a reason to introduce casts throughout the runtime.

## Completion — 2026-11-18

Extracted types, errors, immutable builder, runtime contracts, record composition, validation/preparation, error factories, and execution modules. src/index.ts is a 15-line explicit export list. Added tests/public-api.test.ts asserting the original seven runtime exports. Public interfaces and generic defaults were preserved. Declarations reorder internal definitions after bundling but all public names remain accessible. Root modules have no runtime imports through the public barrel. All four integration/root entry points are preserved, including the concurrently added Oxlint entry.

Verified: `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun fmt --check`, `bun run build`, and `bun pm pack`. Final package consumers passed via `node scripts/check-package.mjs`. Implementation was explicitly requested in the current repository, superseding the earlier read-only advisor workflow. No Git repository, commit, or publication was created.
