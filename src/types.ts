// prettier-ignore
import type { DeclaredError, ErrorFactories, ErrorMap, HookError, StepError, UnexpectedError, ValidationError } from "./errors"
import type { operationResultBrand } from "./runtime/result"
import type { StandardSchemaV1 } from "@standard-schema/spec"
type Schema = StandardSchemaV1
type MaybePromise<T> = T | PromiseLike<T>
type Simplify<T> = { [K in keyof T]: T[K] }
type Empty = Record<never, never>
type OptionalKeys<T> = { [K in keyof T]-?: Empty extends Pick<T, K> ? K : never }[keyof T]

type OptionalOverlap<A, B> = {
  [K in keyof A as K extends OptionalKeys<B> ? K : never]: K extends keyof B ? A[K] | B[K] : never
}

type Merge<A, B> = B extends void
  ? A
  : B extends object
    ? Simplify<Omit<A, keyof B> & Omit<B, OptionalKeys<B> & keyof A> & OptionalOverlap<A, B>>
    : never

type AddErrors<A, B> = Simplify<A & B>

type FailedOperationResult<Input, E extends ErrorMap> = {
  readonly input: Input | undefined
  readonly output: undefined
  readonly error: DeclaredError<E> | ValidationError | StepError | HookError | UnexpectedError
}

export type SafeOperationResult<Input, Output, E extends ErrorMap = Empty> =
  | (OperationResult<Input, Output> & { readonly error: undefined })
  | FailedOperationResult<Input, E>

export type StepContext<Input, Data, Output, E extends ErrorMap = Empty> = {
  readonly errors: ErrorFactories<E>
  readonly input: Input
  readonly data: Readonly<Data>
  readonly setOutput: [Output] extends [never] ? never : (output: Output) => void
}

/** Validated values from a completed run, including middleware contributions */
// eslint-disable-next-line typescript/consistent-type-definitions -- Preserve the public declaration-merging contract
export interface OperationResult<Input, Output> {
  readonly [operationResultBrand]: true
  readonly input: Input
  readonly output: Output
}

export type HookPhase =
  | "beforeRun"
  | "afterRun"
  | "aroundRun"
  | "beforeStep"
  | "afterStep"
  | "aroundStep"

export type RunHookContext<Input, Data, Output, Errors extends ErrorMap = Empty> = StepContext<
  Input,
  Data,
  Output,
  Errors
> & {
  readonly actionName: string | undefined
  readonly middlewareName: string | undefined
}

export type StepHookContext<Input, Data, Output, Errors extends ErrorMap = Empty> = RunHookContext<
  Input,
  Data,
  Output,
  Errors
> & {
  readonly stepName: string
  readonly stepIndex: number
}

declare const actionState: unique symbol
type Combine<A, B> = [A] extends [void] ? B : [B] extends [void] ? A : Merge<A, B>
type RequiredInput<A, B> = [A] extends [void] ? B : [B] extends [void] ? A : Simplify<A & B>

type ActionState = {
  raw: unknown
  input: unknown
  data: unknown
  outputInput: unknown
  output: unknown
  errors: ErrorMap
  stage: "input" | "output" | "steps"
  kind: "action" | "middleware"
  runData: unknown
  beforeStepData: unknown
  started: boolean
}

type InitialState<Kind extends ActionState["kind"]> = {
  raw: void
  input: void
  data: Empty
  outputInput: never
  output: void
  errors: Empty
  stage: "input"
  kind: Kind
  runData: Empty
  beforeStepData: Empty
  started: false
}

type Update<State extends ActionState, Patch> = Omit<State, keyof Patch> & Patch
type BaseData<State extends ActionState> = Merge<State["data"], State["runData"]>
type StepData<State extends ActionState> = Merge<BaseData<State>, State["beforeStepData"]>
type FinalData<State extends ActionState> = BaseData<State>

type RunContext<State extends ActionState, Data> = RunHookContext<
  State["input"],
  Data,
  State["outputInput"],
  State["errors"]
>

type PerStepContext<State extends ActionState, Data> = StepHookContext<
  State["input"],
  Data,
  State["outputInput"],
  State["errors"]
>

type HookResult = Record<string, unknown> | void

type Arguments<State extends ActionState> = undefined extends State["raw"]
  ? [input?: State["raw"]]
  : [input: State["raw"]]

/** Immutable action builder. Hook data follows execution phases, not declaration order. */
export type ActionBuilder<State extends ActionState> = {
  readonly [actionState]: State
  errors<Added extends ErrorMap>(
    definitions: Added,
  ): ActionBuilder<Update<State, { errors: AddErrors<State["errors"], Added> }>>
  step<Result extends HookResult>(
    name: string,
    handler: (
      context: StepContext<State["input"], StepData<State>, State["outputInput"], State["errors"]>,
    ) => MaybePromise<Result>,
  ): ActionBuilder<
    Update<
      State,
      {
        data: Merge<StepData<State>, Result>
        stage: "steps"
        started: true
      }
    >
  >
  afterRun(
    name: string,
    handler: (context: RunContext<State, FinalData<State>>) => MaybePromise<void>,
  ): ActionBuilder<State>
  aroundRun(
    name: string,
    handler: (
      context: Omit<RunContext<State, Partial<FinalData<State>>>, "setOutput"> & {
        readonly run: () => Promise<void>
      },
    ) => MaybePromise<void>,
  ): ActionBuilder<State>
  run(...args: Arguments<State>): Promise<OperationResult<State["input"], State["output"]>>
  runSafe(
    ...args: Arguments<State>
  ): Promise<SafeOperationResult<State["input"], State["output"], State["errors"]>>
} & (State["started"] extends false
  ? {
      beforeRun<Result extends HookResult>(
        name: string,
        handler: (context: RunContext<State, State["runData"]>) => MaybePromise<Result>,
      ): ActionBuilder<Update<State, { runData: Merge<State["runData"], Result> }>>
      beforeStep<Result extends HookResult>(
        name: string,
        handler: (context: PerStepContext<State, StepData<State>>) => MaybePromise<Result>,
      ): ActionBuilder<Update<State, { beforeStepData: Merge<State["beforeStepData"], Result> }>>
      afterStep(
        name: string,
        handler: (context: PerStepContext<State, StepData<State>>) => MaybePromise<void>,
      ): ActionBuilder<State>
      aroundStep(
        name: string,
        handler: (
          context: Omit<PerStepContext<State, Partial<StepData<State>>>, "setOutput"> & {
            readonly runStep: () => Promise<void>
          },
        ) => MaybePromise<void>,
      ): ActionBuilder<State>
    }
  : Empty) &
  (State["stage"] extends "input"
    ? {
        use<
          Other extends ActionState & {
            kind: "middleware"
            raw: object | void
            input: object | void
            output: object | void
          },
        >(
          middleware: { readonly [actionState]: Other } & (keyof State["errors"] &
            keyof Other["errors"] extends never
            ? unknown
            : never),
        ): ActionBuilder<
          Update<
            State,
            {
              raw: RequiredInput<State["raw"], Other["raw"]>
              input: Combine<State["input"], Other["input"]>
              data: Merge<State["data"], FinalData<Other>>
              output: Combine<State["output"], Other["output"]>
              errors: AddErrors<State["errors"], Other["errors"]>
            }
          >
        >
        input<SchemaType extends Schema>(
          schema: SchemaType &
            ([State["input"]] extends [void] ? unknown : StandardSchemaV1<object, object>),
        ): ActionBuilder<
          Update<
            State,
            {
              raw: RequiredInput<State["raw"], StandardSchemaV1.InferInput<SchemaType>>
              input: Combine<State["input"], StandardSchemaV1.InferOutput<SchemaType>>
              stage: "output"
            }
          >
        >
      }
    : Empty) &
  (State["stage"] extends "input" | "output"
    ? {
        output<SchemaType extends Schema>(
          schema: SchemaType &
            ([State["output"]] extends [void] ? unknown : StandardSchemaV1<object, object>),
        ): ActionBuilder<
          Update<
            State,
            {
              outputInput: StandardSchemaV1.InferInput<SchemaType>
              output: Combine<State["output"], StandardSchemaV1.InferOutput<SchemaType>>
              stage: "steps"
            }
          >
        >
      }
    : Empty)

export type Action = ActionBuilder<InitialState<"action">>
export type ActionMiddleware = ActionBuilder<InitialState<"middleware">>
