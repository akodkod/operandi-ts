# Plan 004: Tighten dependencies and measure plugin packaging options

- **Priority:** P2
- **Effort:** M
- **Risk:** MED; install and declaration consumers can differ from the development workspace
- **Depends on:** 002-split-core-modules.md; run after 003 to avoid overlapping verification
- **Category:** migration, tests
- **Confidence:** HIGH for dependency usage; savings require measurement

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

The core has no external runtime imports, but the optional Vite entry introduces Babel and MagicString as unconditional installation dependencies. Optimize only where measurements support it. Preserve existing import paths and scope-aware transforms; a smaller manifest is not automatically a smaller install.

## Current state

`package.json` dependencies declares production dependencies `@babel/parser`, `@babel/traverse`, `@babel/types`, `@standard-schema/spec`, and `magic-string`. Vite is an optional peer (`>=6.0.0`). Zod, Valibot, and ArkType are development dependencies used by interoperability tests; they are not redundant production validators. All six listed ESLint plugins are referenced by `oxlint.config.json`.

`src/vite.ts:1–5`:

```ts
import { parse } from "@babel/parser"
import traverseModule, { type NodePath } from "@babel/traverse"
import type { Node } from "@babel/types"
import { MagicString } from "magic-string"
import type { Plugin } from "vite"
```

The plugin uses `path.scope.getBinding(callee.name)` to distinguish imported factories from shadowed functions. Its public declarations need Vite types, not Babel Node types. Babel parser/traverse themselves depend on `@babel/types` in `bun.lock`; moving the direct declaration to devDependencies will not remove that transitive package. The root publicly re-exports `StandardSchemaV1`, so retain `@standard-schema/spec` as a production type dependency unless generated declarations demonstrably inline it (do not change that policy here).

`tests/vite.test.ts` includes alias/shadowing, JSX/TSX, escaping, source-map, explicit-name preservation, and real Vite development/production tests. The local lock resolves Vite through Vite+, so local success alone does not establish compatibility with every version in the optional peer range.

## Scope

In scope: `package.json`, `bun.lock`, `vite.config.ts` only for a measured packaging experiment, `tests/package.test.ts` or `scripts/check-package.mjs` for repeatable distribution checks, `README.md` dependency explanation, `plans/004-dependency-results.md` for measurements, and this plan/index completion notes. Temporary isolated consumer fixtures may live under an OS temporary directory.

Out of scope: parser replacement, regex-based scope resolution, plugin feature changes, publishing, separate package creation, widening/narrowing peer support without tested evidence, changing core APIs, removing schema interoperability or lint plugins merely because they are dev-only.

## Steps

### 1. Measure the existing distribution

Run `bun run build` and `bun pm pack`. Create clean temporary consumer projects, installing the local tarball without the workspace's node_modules or symlinks: one core-only production install and one plugin install with an explicit supported Vite version. Record package-manager/runtime versions, installed package count, installed directory size, compressed tarball size, runtime external imports, and declaration external imports in `plans/004-dependency-results.md`. Distinguish disk size from compressed package size and runtime loading from installation cost. Use the same manager and platform for comparisons.

Also create a third clean ESLint consumer fixture with the existing optional ESLint peer explicitly installed. Import `operandi/eslint`, run the multiline-step rule against one violating and one valid fixture, and typecheck its exported plugin declaration. Preserve the ESLint peer and its dev dependency; inspect emitted declarations before considering the dev-only ESTree type dependency. This plugin appeared during planning and its implementation is outside the architecture refactor.

In the core fixture import `operandi` and execute a no-input action with Node. In the plugin fixture import `operandi/vite` with Node and run a Vite transform of a named factory declaration. Typecheck consumer files using a separate development tool fixture so compiler/test dependencies do not contaminate production-size measurements. Test NodeNext module resolution with skipLibCheck disabled, core input/output inference, typed error narrowing, and plugin option types.

**Verify:** `bun run build`, `bun pm pack`, all three Node fixtures, and consumer typechecks exit 0. Record their exact repeatable invocation commands and fixture sources in the results file; record network or supported-version limitations explicitly rather than claiming a compatibility matrix.

### 2. Correct direct dependency classification

Inspect generated `dist/vite.d.mts` and every declaration it references. If none require `@babel/types`, move the direct `@babel/types` declaration to devDependencies at the same version range, then refresh the lockfile with `bun install`. Retain parser, traverse, and MagicString as production dependencies while the published plugin imports them. Keep the schema-spec dependency because consumers use its exported types. Do not upgrade versions in this plan.

Add a repeatable package smoke check using the fixtures from step 1. Keep it separate from fast unit tests if it installs dependencies; invoke it explicitly during release verification. Document that the classification change may save no installed packages because Babel still needs its types package at runtime.

**Verify:** `bun install --frozen-lockfile`, `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun run build`, and `bun pm pack` exit 0. Repeat clean consumer checks and compare measurements to step 1. If declarations unexpectedly expose Babel types, retain the production dependency and document why.

### 3. Evaluate larger savings without changing public packaging

Write a bounded comparison in the results file:

- Current independent subpath: root avoids loading plugin dependencies, but installation still includes them.
- Bundling plugin dependencies: measure a temporary build experiment if the installed packer supports it; retain no config change unless all three clean consumer tests pass and the measurements demonstrate a worthwhile improvement. Account for source maps and third-party license notices before recommending shipping bundled dependencies.
- A separate plugin package: describe expected installation separation and the extra release/migration burden. Do not create it; it changes package ownership/import ergonomics and needs a separate selected implementation plan.

Do not move Babel dependencies to optional peers as a shortcut: that would burden existing plugin consumers with new setup. Do not replace Babel's scope analysis with name matching. Keep this an evidence-backed decision, even if the conclusion is to retain the current distribution.

**Verify:** results file contains before/after metrics, exact consumer commands, the chosen option and rationale, and any untested assumptions. Final `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun run build`, `bun pm pack`, and clean consumer checks all pass. Remove temporary experiments from tracked source/config before finalizing unless they meet the explicit gates above.

## Test plan

Add a repeatable packed-artifact test for root/Vite/ESLint imports and consumer declarations. Do not substitute source imports or symlink workspace node_modules: those conceal missing production dependencies. Preserve every Vite AST transform test, particularly shadowing and CommonJS/ESM traverse interop. Test runtime imports with Node, because Bun alone can conceal loader compatibility issues.

## Done criteria

- [x] Production/type/dev dependency usage is recorded with evidence.
- [x] Clean consumer runtime and strict declaration checks pass for all three entry points.
- [x] Root runtime still does not import Babel/MagicString/Vite.
- [x] No version upgrades or accidental loss of interoperability tests.
- [x] Before/after measurements distinguish manifest cleanup from actual installation savings.
- [x] Separate-package proposal is either deferred with rationale or specified as follow-up, never silently shipped.
- [x] All final gates pass; results and index status updated.

## Specific STOP conditions

Stop if a clean consumer cannot resolve published declarations, Node interop differs from Bun, packaging requires license handling not yet understood, or the only savings require changing public import paths. Network unavailability blocks clean-install claims; record it rather than treating cached workspace modules as equivalent verification.

## Maintenance notes

A type-only source import is not enough to decide dependency placement: inspect emitted public declarations. Root bundle size and total install size are different metrics. The broad Vite peer range remains a compatibility-testing follow-up; do not claim all versions are verified by a single local Vite+ run. No security advisory or latest-version audit was performed in the architecture review.

## Completion — 2026-11-18

Moved @babel/types to devDependencies without changing its version. Refreshed bun.lock and verified frozen installation. Added scripts/check-package.mjs and check:package for separate production consumers and a compiler fixture. All four clean consumers passed Node runtime checks and strict NodeNext declaration checks. Recorded before/after metrics and a temporary bundling size experiment in 004-dependency-results.md. Retained the existing dependency architecture after measurement; no separate integration package or bundled third-party distribution was shipped.

Verified: `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun fmt --check`, `bun run build`, and `bun pm pack`. Final package consumers passed via `node scripts/check-package.mjs`. Implementation was explicitly requested in the current repository, superseding the earlier read-only advisor workflow. No Git repository, commit, or publication was created.
