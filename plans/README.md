# Package improvement plans

Prepared with the improve skill on 2026-11-18. The user selected all four findings. These are implementation handoffs; no package source was changed while writing them.

## Execution order and status

| Plan                                | Outcome                                            | Priority | Effort | Depends on         | Status |
| ----------------------------------- | -------------------------------------------------- | -------- | ------ | ------------------ | ------ |
| [001](001-verification-baseline.md) | Consistent lint/format gates and accurate docs     | P1       | M      | —                  | DONE   |
| [002](002-split-core-modules.md)    | Core split into cohesive modules                   | P1       | M      | 001                | DONE   |
| [003](003-simplify-invocation.md)   | Separate callback and continuation execution       | P2       | M      | 002                | DONE   |
| [004](004-dependency-packaging.md)  | Dependency cleanup and measured packaging decision | P2       | M      | 002; run after 003 | DONE   |

Statuses: TODO, IN PROGRESS, DONE, BLOCKED (reason), REJECTED (reason). Executors must read the whole selected plan, respect its boundaries, and record completion evidence before changing status. Do not mark a plan done merely because source was edited.

## Dependency notes

001 separates mechanical cleanup from architecture changes. 002 moves existing behavior unchanged. 003 adds async characterization before simplifying it. 004 verifies the resulting published package in isolated consumers and measures costs before recommending a packaging change. Preserve public factories, strict type inference, run/runSafe shapes, and void-only after hooks throughout.

No Git repository exists in the reviewed workspace; there is no commit SHA to stamp or worktree to create. Do not initialize Git as part of execution. `baseline.sha256` records reviewed files; later plans must reconcile expected prerequisite changes rather than blindly reject all hash differences. If using the improve skill's executor/worktree mode, first report that isolated Git worktrees are unavailable; these plans can instead be handed to a separate implementation session with ordinary filesystem access.

## Verification baseline

- `bun check`: passed, 12 files.
- `bun test`: passed, 64 tests / 253 assertions across six files.
- `bun run lint`: fails; 001 establishes the usable baseline.
- Build/pack and clean consumer checks are required executor gates, not performed in this read-only review.
- Source: core (`src/index.ts`, 690 lines), Vite plugin (`src/vite.ts`, 125 lines), and ESLint plugin (`src/eslint.ts`), strict TypeScript, Bun tests, Vite+ ESM packaging.

## Findings considered and rejected

- Remove Zod, Valibot, or ArkType as duplicate runtime dependencies: rejected; they are dev-only interoperability coverage.
- Remove ESLint plugins because there are many: rejected; all declared plugins are referenced by configuration. Investigate concrete rule conflicts instead.
- Replace Babel with regex or a shallow identifier walk: rejected; aliases and lexical shadowing are tested behavior.
- Treat `@babel/types` reclassification as a major size win: rejected; Babel depends on it transitively.
- Move `@standard-schema/spec` to devDependencies merely because imports are type-only: rejected; exported declarations depend on it.
- Change hook data ownership, continuation requirements, or after-hook return values during refactoring: rejected; documented behavior and explicit user requirements.
- Immediately publish a separate plugin package: deferred pending measured benefit and a separate implementation decision.

## Review limits

Focused on architecture, dependency usage, and local verification. No vulnerability database audit, latest-version review, broad Vite-version compatibility matrix, or runtime performance benchmark was performed. No additional feature roadmap is proposed because this task concerns readability and packaging.

The ESLint plugin arrived during plan preparation. The final baseline includes its passing tests and preserves its export/dependency contracts; its implementation was not deeply audited. The source/config hashes were refreshed to capture this observed user work, not to record advisor source changes.

## Implementation completed — 2026-11-18

All four plans implemented in the current repository at the user's explicit request. The concurrent package rename to `operandi` and native Oxlint integration were preserved. There are now four entry points: core, Vite, ESLint, and Oxlint.

Final checks: 71 tests / 286 assertions, strict type checking, local and CI lint, formatting, build, pack, frozen lockfile installation, and isolated Node/NodeNext consumers all pass. See each plan's completion section and [dependency measurements](004-dependency-results.md). `baseline.sha256` remains the historical pre-implementation drift snapshot, not the final file state.
