import type { HookPhase } from "../types"
import type { RuntimeContext, Step } from "./definition"
import { createErrorFactories } from "./error-factories"

type AroundPhase = "aroundRun" | "aroundStep"
type CallbackPhase = Exclude<HookPhase, AroundPhase>

type Location = { stepName: string | undefined; stepIndex: number }

export type Invocation = Location &
  ({ kind: "step"; entry: Step } | { kind: "hook"; entry: Step; phase: HookPhase })

type CallbackInvocation = Location &
  ({ kind: "step"; entry: Step } | { kind: "hook"; entry: Step; phase: CallbackPhase })

type AroundInvocation = Location & { kind: "hook"; entry: Step; phase: AroundPhase }

export type InvocationEnvironment = {
  actionName: string | undefined
  middlewareName: string | undefined
  input: unknown
  readData: () => Readonly<Record<string, unknown>>
  mergeData: (result: unknown, owner: object) => void
  setOutput: (value: unknown) => void
  fail: (cause: unknown, invocation: Invocation) => Promise<never>
}

function createContext(
  environment: InvocationEnvironment,
  invocation: Invocation,
  lifetime: { active: boolean },
  around: boolean,
): RuntimeContext {
  return {
    actionName: environment.actionName,
    middlewareName: environment.middlewareName,
    input: environment.input,
    stepName: invocation.stepName,
    stepIndex: invocation.stepIndex,
    errors: createErrorFactories(invocation.entry.errors),
    get data() {
      return environment.readData()
    },
    setOutput(value: unknown) {
      if (!lifetime.active)
        throw new Error("setOutput must be called before the step or hook finishes")

      if (around) throw new Error("Around hooks cannot set output")
      environment.setOutput(value)
    },
  }
}

export async function invokeCallback(
  environment: InvocationEnvironment,
  invocation: CallbackInvocation,
) {
  const lifetime = { active: true }

  try {
    const result = await invocation.entry.handler(
      createContext(environment, invocation, lifetime, false),
    )

    if (
      invocation.kind === "hook" &&
      (invocation.phase === "afterRun" || invocation.phase === "afterStep")
    ) {
      if (result !== undefined) throw new TypeError(`${invocation.phase} hooks must return void`)
    } else {
      environment.mergeData(result, invocation.entry)
    }
  } catch (cause) {
    await environment.fail(cause, invocation)
  } finally {
    lifetime.active = false
  }
}

export async function invokeAround(
  environment: InvocationEnvironment,
  invocation: AroundInvocation,
  continuation: () => Promise<void>,
) {
  const state: {
    active: boolean
    pending: Promise<void> | undefined
    invalid: boolean
    failure: { cause: unknown } | undefined
  } = { active: true, pending: undefined, invalid: false, failure: undefined }

  const run = () => {
    if (!state.active || state.pending) {
      state.invalid = true
      throw new TypeError("A continuation must be called exactly once while its hook is active")
    }

    state.pending = continuation()

    // Observe rejection even when the wrapper does not await its continuation
    void state.pending.catch((cause: unknown) => {
      state.failure = { cause }
    })

    return state.pending
  }

  const context = createContext(environment, invocation, state, true)
  Object.assign(context, invocation.phase === "aroundRun" ? { run } : { runStep: run })

  try {
    const result = await invocation.entry.handler(context)

    if (!state.pending || state.invalid)
      throw new TypeError("An around hook must call its continuation exactly once")

    await state.pending
    if (result !== undefined) throw new TypeError("Around hooks must return void")
  } catch (cause) {
    // Finish pending work before reporting a wrapper failure
    if (state.pending) {
      try {
        await state.pending
      } catch {
        /* Failure identity is checked below */
      }
    }

    if (state.failure && cause === state.failure.cause) throw cause
    await environment.fail(cause, invocation)
  } finally {
    state.active = false
  }

  if (state.failure) throw state.failure.cause
}
