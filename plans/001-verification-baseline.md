# Plan 001: Establish consistent lint and formatting gates

- **Priority:** P1
- **Effort:** M
- **Risk:** LOW–MED; broad mechanical edits must preserve type-test intent
- **Depends on:** none
- **Category:** dx, docs
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

The test/type baseline passes, but lint is not a useful regression gate because existing source and configuration disagree. Establish a repeatable style and accurate documentation before moving code, so formatting churn is separate from structural review.

## Current state

- `oxlint.config.json:398` configures `"@stylistic/semi": ["error", "never"]`; `src/index.ts` and `vite.config.ts` use semicolons, while `src/vite.ts` does not.
- `vite.config.ts:7` adds extra rules when CI is `1`, `true`, or `yes`; check both paths.
- `package.json` scripts: `"prepublishOnly": "bun check && bun test && bun run build"` currently omits lint.
- `README.md` development section: `The package has no runtime imports`; the root has no external runtime imports, but the Vite entry imports Babel and MagicString.
- Existing `tests/types.ts:228` intentionally uses `async () => ({ unused: true })` under `@ts-expect-error` to verify forbidden after-hook return values. Lint reports `require-await` here. Do not change these into unrelated fixtures just to satisfy lint.
- `tests/hooks.test.ts` uses Bun `test`/`expect`, explicit execution arrays, and assertions on error metadata. Preserve this test style.

## Scope

In scope: `oxlint.config.json`, `vite.config.ts`, `package.json` scripts only, `README.md`, a formatter configuration only if supported by the installed Bun formatter, mechanical style/type-only adjustments in existing `src/*.ts` and `tests/*.ts`, and completion notes in this plan/index.

Out of scope: dependency/version changes, module extraction, algorithm changes, API changes, new blanket ignores or globally disabling lint correctness rules.

## Steps

### 1. Capture and classify the baseline

Run `bun check`, `bun test`, `bun run lint`, and `CI=true bun run lint`. Save complete diagnostics in a temporary directory, not source. Group by formatting, intentional test fixtures, type-signature false positives, and genuine concerns. Record counts and rule names in completion notes. Determine the installed formatter's supported configuration using `bun fmt --help`; do not guess a configuration filename or download another formatter.

**Verify:** `bun check` and `bun test` exit 0 with all 64 baseline tests. Lint failures are expected only at this step and must be classified before editing.

### 2. Align mechanical formatting with the repository's configured style

Prefer the existing no-semicolon lint convention. Configure Bun's formatter to agree if its installed version supports the required settings. Resolve any formatter/linter overlap at the narrowest level: let one own incompatible presentation rules, document the exact conflict, and retain correctness rules. Apply formatting only to the scope above; do not reformat generated `dist` or lockfiles.

For diagnostics on deliberate async fixtures or type-only parameter names, use the smallest documented rule exception (test override or individual line); preserve `@ts-expect-error` immediately adjacent to its intended failing expression. Do not replace `unknown` with `any`, alter await timing, or rewrite callback behavior to placate a mistaken diagnostic. If a genuine semantic defect is discovered, stop that item and report it separately rather than fixing it inside style cleanup.

**Verify:** `bun check`, `bun test`, `bun run lint`, and `CI=true bun run lint` all exit 0. Run `bun fmt --check` with the settled configuration; it must exit 0. Run formatter and lint a second time to ensure they do not fight each other.

### 3. Document and enforce the usable gates

Update README's development section with the actual formatter configuration and commands. State that the core entry has no external runtime imports, whereas the Vite entry uses Babel and MagicString. Add `bun run lint` to `prepublishOnly` before the build once it is green. Keep the existing Bun and Vite+ toolchain. Add a completion note explaining narrow rule exceptions so subsequent refactors preserve them.

**Verify:** run `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun fmt --check`, and `bun run build`; all exit 0. Review the file inventory against Scope.

## Test plan

No new behavior tests: this plan is mechanical. Retain all runtime tests and all positive/negative compile assertions, especially async after-hook rejections. No fixture should lose its reason for existing.

## Done criteria

- [x] All gates in step 3 pass, including both lint configurations.
- [x] The 64 baseline runtime tests remain and pass.
- [x] The formatter and linter accept the same source on repeated checks.
- [x] README distinguishes the root entry from the Vite entry's dependencies.
- [x] No dependency versions or runtime algorithms changed.
- [x] Completion notes and index status updated, with exceptions listed.

## Specific STOP conditions

If formatter compatibility requires replacing Bun/Vite+, stop and report the exact conflicting rules. If fixing lint requires changing lifecycle behavior or broad suppressions, stop and propose a narrower follow-up rather than hiding the issue.

## Maintenance notes

Reviewers should distinguish mechanical changes from configuration exceptions. Keep type regression fixtures meaningful; an intentionally invalid callback must remain invalid for its intended reason. Future files should use the settled formatter rather than copying the old mixed style.

## Completion — 2026-11-18

Configured Bun's formatter for no semicolons and width 100. Disabled six conflicting presentation rules (indentation, member delimiters, vertical spacing, and import wrapping), retaining correctness rules. Replaced the JavaScript unused-variable rule with native TypeScript-aware checking. Scoped async/thenable exceptions to tests and void/empty-merge-identity exceptions to builder type fixtures. Kept public ErrorDefinition and OperationResult interfaces with targeted consistent-type-definitions exceptions. Native AST location guards have a line exception; Vite compatibility tests retain rollupOptions with a file-specific CI deprecation exception. Public ESLint/Oxlint default exports are allowed explicitly. Restored green local/CI lint, added lint to prepublishOnly, and documented tool ownership. The original lint log is /tmp/operandi-lint-current.log. No callback behavior was altered for lint.

Verified: `bun check`, `bun test`, `bun run lint`, `CI=true bun run lint`, `bun fmt --check`, `bun run build`, and `bun pm pack`. Final package consumers passed via `node scripts/check-package.mjs`. Implementation was explicitly requested in the current repository, superseding the earlier read-only advisor workflow. No Git repository, commit, or publication was created.
