import lintConfig from "./oxlint.config.json"
import { defineConfig, type UserConfig } from "vite-plus"

const sharedLint = lintConfig as NonNullable<UserConfig["lint"]>

const isCI = ["1", "true", "yes"].includes(process.env.CI?.toLowerCase() ?? "")

export default defineConfig({
  lint: {
    ...sharedLint,
    overrides: [
      ...(sharedLint.overrides ?? []),
      ...(isCI
        ? [
            {
              files: ["**/*.ts"],
              rules: {
                "import/namespace": "error" as const,
                "typescript/no-deprecated": "error" as const,
              },
            },
          ]
        : []),

      // Vite 6 compatibility fixtures intentionally use rollupOptions
      { files: ["tests/vite.test.ts"], rules: { "typescript/no-deprecated": "off" as const } },
    ],
  },
  pack: {
    entry: ["src/index.ts", "src/vite.ts", "src/eslint.ts", "src/oxlint.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
})
