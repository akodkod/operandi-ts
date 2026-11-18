# Dependency and distribution results

Implemented and verified 2026-11-18 on macOS arm64, Node 26.13.1 and Bun 1.4.4.

## Decision

Moved the direct `@babel/types` declaration from production to development dependencies at the same version range. The source only imports its types, and the public Vite declaration imports only Vite. Babel still requires its types package transitively, so installed package counts do not shrink. Retained `@standard-schema/spec` for public declarations, Babel parser/traverse and MagicString for the Vite plugin, and `@oxlint/plugins` for the ESLint adapter/runtime and Oxlint declarations. Retained validator test libraries and referenced lint plugins.

No separate package or bundled third-party code was shipped. The current independent export paths avoid loading integrations when importing the core, while all integrations' dependencies still install together. A separate integration package could reduce core-only installation cost, but it introduces another release/versioning boundary and import migration. Defer that product decision.

The repository was concurrently renamed from `operandi-ts` to `operandi` and gained the Oxlint entry point. Those changes were preserved. The consumer checker derives the current package and tarball names from the manifest.

## Reproduction

```sh
bun run build
bun pm pack
bun run check:package
# Alternatively pass an explicit tarball:
node scripts/check-package.mjs /absolute/path/to/package.tgz
```

All fixture sources and exact install/compiler invocations live in `scripts/check-package.mjs`. It creates clean temporary consumer directories with independent installs from the tarball, no workspace node_modules symlinks, and a temporary Bun cache. Installs use `--ignore-scripts`. The compiler and Node type definitions are installed into a separate fixture; all consumers compile with strict NodeNext resolution and skipLibCheck disabled. Fixtures are retained for inspection and their path is printed.

Verified root execution, typed input/output/error narrowing, invalid after-hook return rejection, Vite 6.4.0 production transformation under Node, ESLint 10.15.0 valid/invalid rule results, and the native Oxlint entry's rule shape. Local unit tests separately cover real Oxlint execution and Vite development/production pipelines. Vite 6's development server did not settle cleanly under Node 26 in the first isolated fixture, so that clean fixture uses production `build` with `write: false`; no broad dev-server compatibility claim is made.

## Production installation measurements

Package counts count the hoisted package directories (including scoped packages) in each consumer's node_modules. Bytes are logical file sizes recursively summed, including followed symlink targets, not filesystem allocated blocks. Compiler dependencies are excluded. The optional Vite/ESLint peers are only explicitly installed in their respective fixtures.

| Consumer | Packages before | Packages after | Bytes before | Bytes after |
| -------- | --------------: | -------------: | -----------: | ----------: |
| core     |              22 |             22 |    7,196,139 |   7,197,290 |
| vite     |              35 |             35 |   35,600,950 |  35,602,101 |
| eslint   |              96 |             96 |   19,150,256 |  19,151,407 |
| oxlint   |              22 |             22 |    7,196,139 |   7,197,290 |

Tarball: 24,530 bytes before, 24,982 bytes after. The small byte increase includes README, architecture/source-map, public interface, and package-name changes between measurements; it is not a dependency-size regression attributable to reclassification. Neither package count nor dependency versions changed from the type-only dependency move.

Final successful fixtures: `/var/folders/zl/wzmz93ds235g9l_j5q8fvw380000gn/T/operandi-package-cz6DrG`.

## Runtime and declaration boundaries

| Entry  | External runtime imports                           | External declaration imports |
| ------ | -------------------------------------------------- | ---------------------------- |
| Core   | None                                               | `@standard-schema/spec`      |
| Vite   | `@babel/parser`, `@babel/traverse`, `magic-string` | `vite`                       |
| ESLint | `@oxlint/plugins`, local Oxlint module             | `eslint`                     |
| Oxlint | None                                               | `@oxlint/plugins`            |

All four export targets and declarations exist in the final tarball and pass clean Node imports/type checks. The root exports exactly the original seven runtime names. Existing compiler tests continue to cover middleware composition and schema transformations.

## Bundling experiment (not shipped)

Ran the installed Vite+ packer's programmatic build on `src/vite.ts` into `/tmp/operandi-bundled-plugin`, with `deps.alwaysBundle` matching Babel, MagicString, their mapping dependencies, debug/ms, jsesc, and js-tokens. The actual experiment imported `build` from the installed `node_modules/vite-plus/dist/pack.js`; no repository build config was changed.

```js
await build({
  entry: ["/absolute/repository/src/vite.ts"],
  config: false,
  outDir: "/tmp/operandi-bundled-plugin",
  format: "esm",
  sourcemap: true,
  dts: false,
  deps: {
    alwaysBundle: [
      /^@babel\//,
      /^magic-string$/,
      /^@jridgewell\//,
      /^debug$/,
      /^ms$/,
      /^jsesc$/,
      /^js-tokens$/,
    ],
  },
})
```

| File            | External dependencies: bytes / gzip | Bundled experiment: bytes / gzip |
| --------------- | ----------------------------------: | -------------------------------: |
| Vite JS         |                       3,009 / 1,172 |              1,430,119 / 266,844 |
| Vite source map |                       5,816 / 2,116 |              2,508,843 / 439,350 |

The experimental output is only a size probe, not a verified shippable package. It was not substituted into the release tarball. Bundling might still reduce total installed dependency files, but proving that benefit requires a separate full-consumer/license-notice evaluation. The current task therefore retains external dependencies rather than claiming a smaller distribution without that evidence.

## Limits

No advisory database or latest-version audit, comprehensive peer-version matrix, or runtime performance benchmark was performed. The existing TypeScript 7 experimental build warning and deprecated stylistic-rule warnings remain non-fatal tooling warnings.
