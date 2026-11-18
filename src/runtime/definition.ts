import type { ErrorMap, OperandiError } from "../errors"
import type { HookPhase, StepContext } from "../types"
import type { StandardSchemaV1 } from "@standard-schema/spec"

export type Schema = StandardSchemaV1
export type RuntimeFactories = Record<
  string,
  (options?: { data?: unknown; message?: string; cause?: unknown }) => OperandiError
>
export type RuntimeContext = Omit<
  StepContext<unknown, Record<string, unknown>, unknown>,
  "errors"
> & {
  errors: RuntimeFactories
  actionName?: string | undefined
  middlewareName?: string | undefined
  stepName?: string | undefined
  stepIndex?: number
}
export type Step = { name: string; handler: (context: RuntimeContext) => unknown; errors: ErrorMap }

export type Hook = Step & { phase: HookPhase }
export type Definition = {
  kind: "action" | "middleware"
  name: string | undefined
  hooks: readonly Hook[]
  errors: ErrorMap
  inputSchema?: Schema
  outputSchema?: Schema
  steps: readonly Step[]
  middleware: readonly Definition[]
}
export type Prepared = { definition: Definition; input: unknown; middleware: Prepared[] }
