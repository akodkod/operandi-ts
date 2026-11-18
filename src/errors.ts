import type { HookPhase } from "./types"
import type { StandardSchemaV1 } from "@standard-schema/spec"

type Schema = StandardSchemaV1

// eslint-disable-next-line typescript/consistent-type-definitions -- Preserve the public declaration-merging contract
export interface ErrorDefinition {
  readonly message?: string
  readonly data?: StandardSchemaV1
}

export type ErrorMap = Record<string, ErrorDefinition>

type ErrorInput<D> = D extends { data: infer S extends Schema }
  ? StandardSchemaV1.InferInput<S>
  : "data" extends keyof D
    ? unknown
    : undefined

type ErrorOutput<D> = D extends { data: infer S extends Schema }
  ? StandardSchemaV1.InferOutput<S>
  : "data" extends keyof D
    ? unknown
    : undefined

type ErrorOptions<Data> = { message?: string; cause?: unknown } & (undefined extends Data
  ? { data?: Data }
  : { data: Data })

export type ErrorFactories<E extends ErrorMap> = {
  readonly [K in keyof E & string]: (
    ...args: undefined extends ErrorInput<E[K]>
      ? [options?: ErrorOptions<ErrorInput<E[K]>>]
      : [options: ErrorOptions<ErrorInput<E[K]>>]
  ) => OperandiError<K, ErrorInput<E[K]>>
}

export type DeclaredError<E extends ErrorMap> = {
  [K in keyof E & string]: OperandiError<K, ErrorOutput<E[K]>>
}[keyof E & string]

export class OperandiError<Code extends string = string, Data = unknown> extends Error {
  constructor(
    public readonly code: Code,
    public readonly data: Data,
    options: { message?: string; cause?: unknown } = {},
  ) {
    super(options.message ?? code, { cause: options.cause })
    this.name = "OperandiError"
  }
}

export class UnexpectedError extends Error {
  readonly code = undefined

  constructor(cause: unknown) {
    super("Unexpected operation failure", { cause })
    this.name = "UnexpectedError"
  }
}

export class HookError extends Error {
  readonly code = undefined

  constructor(
    public readonly phase: HookPhase,
    public readonly hookName: string,
    cause: unknown,
    public readonly actionName?: string,
    public readonly stepName?: string,
  ) {
    super(`${phase} hook "${hookName}" failed`, { cause })
    this.name = "HookError"
  }
}

export class ValidationError extends Error {
  readonly code = undefined

  constructor(
    public readonly phase: "input" | "output" | "error",
    public readonly issues: readonly StandardSchemaV1.Issue[],
  ) {
    super(`Invalid ${phase}: ${issues.map((issue) => issue.message).join("; ")}`)
    this.name = "ValidationError"
  }
}

export class StepError extends Error {
  readonly code = undefined

  constructor(
    public readonly stepName: string,
    public readonly stepIndex: number,
    cause: unknown,
  ) {
    super(`Step "${stepName}" failed`, { cause })
    this.name = "StepError"
  }
}
