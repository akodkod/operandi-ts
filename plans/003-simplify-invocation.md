# Plan 003: Separate callback execution from continuation control

- **Priority:** P2
- **Effort:** M
- **Risk:** MED–HIGH; subtle async and error-identity contracts
- **Depends on:** 002-split-core-modules.md
- **Category:** tech-debt, tests
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

The current invocation function handles ordinary steps, before/after hooks, around hooks, output lifetime, data merging, and error normalization in one path. Separate the continuation protocol from ordinary callback execution so readers can follow each without reasoning about irrelevant branches. This is a behavior-preserving refactor, not an opportunity to introduce retries or middleware `next()` semantics.

## Current state

After plan 002 the following logic lives in `src/runtime/execute.ts`; originally it was `src/index.ts:448–522`:

```ts
let pending: Promise<void> | undefined
let continuationFailed = false
let continuationError: unknown
let invalidContinuation = false
```

```ts
if (continuation) {
  if (!pending || invalidContinuation)
    throw new TypeError("An around hook must call its continuation exactly once")
  await pending
  if (result !== undefined) throw new TypeError("Around hooks must return void")
} else if (phase === "afterRun" || phase === "afterStep") {
  if (result !== undefined) throw new TypeError(`${phase} hooks must return void`)
} else {
  mergeData(result, entry)
}
```

The catch path waits for a pending continuation before reporting a wrapper error. When the wrapper propagates the identical inner failure, it preserves its identity. A wrapper that throws a different error takes precedence over the inner failure; characterize this before refactoring. `context.data` is a getter returning a fresh shallow-frozen snapshot, including when read again after continuation.

`tests/hooks.test.ts:169` already verifies omitted/double continuation and swallowed errors; line 200 verifies unawaited continuations. Tests use Bun's `test`/`expect` and public factories. Do not test only new private helpers.

## Scope

In scope: `src/runtime/execute.ts`, new `src/runtime/invoke.ts`, `src/runtime/definition.ts` for minimal internal contract changes, `tests/hooks.test.ts`, `tests/errors.test.ts` for related characterization, and plan/index completion notes.

Out of scope: public types/exports, factory API, error class design/messages, dependency changes, plugin, data collision policy, validation order, configuration lint rules.

## Steps

### 1. Add characterization tests before extraction

Add public-API tests using manually controlled promises rather than timers:

1. Wrapper starts a continuation then throws a distinct error while the continuation is pending: the action waits for settlement, then reports the wrapper's HookError/cause.
2. Wrapper and continuation both fail with distinct values: preserve current precedence and metadata; exercise both run and runSafe.
3. A second continuation call caught inside the wrapper still fails the run and does not execute the body twice.
4. A captured continuation called after the operation settles throws without executing again.
5. A declared error traversing nested run/step wrappers retains its normalized instance and validates its payload only once.
6. Re-reading `context.data` after continuation sees new data while an earlier snapshot stays unchanged and frozen.
7. Captured `setOutput` called after its callback finishes is rejected; around hooks cannot use an untyped setter.

Reuse existing tests if they already cover an exact case; do not duplicate them. Capture actual current behavior and error precedence. If any required documented contract fails before refactoring, report the bug separately instead of silently changing it here.

**Verify:** `bun test tests/hooks.test.ts tests/errors.test.ts` and `bun check` exit 0 on the original runtime before extraction.

### 2. Extract explicit ordinary and around invocation paths

Create `runtime/invoke.ts` with named internal functions `invokeCallback` and `invokeAround`. Represent call metadata with a typed object/discriminated union (step versus hook), rather than optional positional arguments whose meaning changes with phase. Ordinary callbacks handle return policy (merge object or require void), output lifetime, and one error normalization path. Around invocation owns exactly-once state, pending promise observation, awaiting/draining pending work, and inner error identity.

Provide the helpers a narrow per-run environment: read current data, merge returned data with producer identity, write output, and normalize a failure with entry metadata. Keep data/output storage and owners in execute's per-run closure. Avoid a global runner class, service container, generic middleware framework, or duplicated failure normalizers. Construct contexts with a real `data` getter, never a spread that accidentally freezes its value. Preserve runtime return-value guards and the active lifetime of callbacks.

**Verify:** `bun check`, `bun test tests/hooks.test.ts tests/errors.test.ts`, and `bun run lint` exit 0 after migrating ordinary calls, then again after migrating around calls.

### 3. Leave execution order readable in the orchestrator

`execute.ts` should read as the lifecycle: aroundRun → beforeRun → middleware → each aroundStep/beforeStep/step/afterStep → afterRun → output validation. Retain first-registered-outermost wrapper ordering and middleware-local scope. Do not add caching or precompiled hook arrays without an independent reason; this plan targets comprehension.

Remove the old nested `invoke` implementation after all call sites use the two explicit helpers. Keep a single implementation of normalization. Add brief comments only for non-obvious guarantees: observing unawaited rejections, draining pending work, and preserving inner failure identity.

**Verify:** `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, and `bun run build` exit 0. `rg -n 'async function invoke\(' src/runtime/execute.ts` returns no matches. `rg -n 'invokeCallback|invokeAround' src/runtime/invoke.ts src/runtime/execute.ts` finds definitions and callers.

## Test plan

Step 1 is the required regression suite. Use promise resolvers to prove ordering; avoid sleep-based tests and unhandled background rejections. Keep original concurrency, hook ownership, void returns, and typed error tests. Type inference must not change, so `tests/types.ts` should pass without edits.

## Done criteria

- [x] All step 1 cases are covered by passing public-API tests before and after refactoring.
- [x] Ordinary callback path contains no continuation bookkeeping.
- [x] Around invocation retains exactly-once, drain, error identity, and void guarantees.
- [x] Orchestrator calls explicit ordinary/around helpers; old invoke implementation is gone.
- [x] All final gates in step 3 pass, with no public API or type-test changes.
- [x] Completion notes record added test names and index status is updated.

## Specific STOP conditions

Stop if a failed test indicates ambiguous existing error precedence or if a refactor requires changing when a continuation becomes inactive. Do not treat swallowed errors, missing `await`, or duplicate continuation calls as removable defensive complexity: these behaviors are explicitly documented.

## Maintenance notes

Future lifecycle changes must consider both paths. A single shared boolean is not a substitute for distinct pending/completed/invalid continuation states unless the characterization suite proves equivalence. Review async lifetime and error identity more carefully than function length.

## Completion — 2026-11-18

Added five characterization tests covering all seven requested scenarios, including multiple safe/throwing and success/failure combinations inside the pending-work test. They passed against the original runner before extraction. Split invokeCallback and invokeAround with discriminated invocation metadata and a narrow per-run environment. Continuation state uses an explicit object, eliminating the old closure-mutation lint suppressions. Preserved pending-work draining, error precedence/identity, fresh frozen snapshots, setter lifetime, void returns, and execution order. Final suite: 71 passing tests, 286 assertions.

Verified: `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun fmt --check`, `bun run build`, and `bun pm pack`. Final package consumers passed via `node scripts/check-package.mjs`. Implementation was explicitly requested in the current repository, superseding the earlier read-only advisor workflow. No Git repository, commit, or publication was created.
