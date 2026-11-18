import { HookError, OperandiError, StepError } from "../errors"
import type { HookPhase } from "../types"
import type { Prepared } from "./definition"
import { type Invocation, type InvocationEnvironment, invokeAround, invokeCallback } from "./invoke"
import { combine, isRecord } from "./records"
import { validate } from "./validation"

export async function execute(
  prepared: Prepared,
  declaredErrors: Set<OperandiError>,
  actionName: string | undefined = prepared.definition.name,
): Promise<{ data: Record<string, unknown>; output: unknown }> {
  const execution = createExecution(prepared, declaredErrors, actionName)
  await execution.wrap(execution.run)
  return execution.result()
}

type Execution = {
  run: () => Promise<void>
  wrap: (body: () => Promise<void>) => Promise<void>
  result: () => { data: Record<string, unknown>; output: unknown }
}

function createExecution(
  prepared: Prepared,
  declaredErrors: Set<OperandiError>,
  actionName: string | undefined,
): Execution {
  const { definition, input } = prepared

  const middleware = prepared.middleware.map((child) =>
    createExecution(child, declaredErrors, actionName),
  )

  let data: Record<string, unknown> = {}
  let inheritedOutput: unknown
  let output: unknown
  let finalOutput: unknown
  const owners = new Map<PropertyKey, object>()

  function mergeData(result: unknown, owner: object) {
    if (result === undefined) return

    if (!isRecord(result))
      throw new TypeError("Steps and hooks must return a plain object or undefined")

    if (definition.hooks.length > 0) {
      for (const key of Reflect.ownKeys(result)) {
        if (Object.prototype.propertyIsEnumerable.call(result, key)) {
          const previous = owners.get(key)

          if (previous && previous !== owner)
            throw new TypeError(
              `Data field "${String(key)}" already belongs to another step or hook`,
            )

          owners.set(key, owner)
        }
      }
    }

    data = { ...data, ...result }
  }

  async function failure(cause: unknown, invocation: Invocation): Promise<never> {
    const { entry, stepName, stepIndex } = invocation
    if (cause instanceof OperandiError && declaredErrors.has(cause)) throw cause

    if (cause instanceof OperandiError && Object.hasOwn(entry.errors, cause.code)) {
      const errorDefinition = entry.errors[cause.code]!

      const parsed = errorDefinition.data
        ? await validate(errorDefinition.data, cause.data, "error")
        : undefined

      const error = new OperandiError(cause.code, parsed, {
        message: cause.message,
        cause: cause.cause,
      })

      declaredErrors.add(error)
      throw error
    }

    if (invocation.kind === "hook")
      throw new HookError(invocation.phase, entry.name, cause, actionName, stepName)

    throw new StepError(entry.name, stepIndex, cause)
  }

  const environment: InvocationEnvironment = {
    actionName,
    middlewareName: definition.kind === "middleware" ? definition.name : undefined,
    input,
    readData: () => Object.freeze({ ...data }),
    mergeData,
    setOutput(value) {
      if (!definition.outputSchema) throw new Error("setOutput requires an output schema")
      output = value
    },
    fail: failure,
  }

  async function hooks(
    phase: Exclude<HookPhase, "aroundRun" | "aroundStep">,
    stepName?: string,
    stepIndex = 0,
  ) {
    for (const hook of definition.hooks.filter((entry) => entry.phase === phase)) {
      await invokeCallback(environment, { kind: "hook", entry: hook, phase, stepName, stepIndex })
    }
  }

  async function around(
    phase: "aroundRun" | "aroundStep",
    body: () => Promise<void>,
    stepName?: string,
    stepIndex = 0,
  ) {
    const wrappers = definition.hooks.filter((entry) => entry.phase === phase)

    async function next(index: number): Promise<void> {
      const hook = wrappers[index]
      if (!hook) return body()

      await invokeAround(
        environment,
        { kind: "hook", entry: hook, phase, stepName, stepIndex },
        () => next(index + 1),
      )
    }

    await next(0)
  }

  async function run() {
    await hooks("beforeRun")

    for (const child of middleware) {
      await child.run()
      const result = child.result()
      mergeData(result.data, child)
      inheritedOutput = combine(inheritedOutput, result.output)
    }

    for (const [index, step] of definition.steps.entries()) {
      await around(
        "aroundStep",
        async () => {
          await hooks("beforeStep", step.name, index)

          await invokeCallback(environment, {
            kind: "step",
            entry: step,
            stepName: step.name,
            stepIndex: index,
          })

          await hooks("afterStep", step.name, index)
        },
        step.name,
        index,
      )
    }

    await hooks("afterRun")

    const ownOutput = definition.outputSchema
      ? await validate(definition.outputSchema, output, "output")
      : undefined

    finalOutput = combine(inheritedOutput, ownOutput)
  }

  async function wrap(body: () => Promise<void>) {
    async function next(index: number): Promise<void> {
      const child = middleware[index]
      if (!child) return around("aroundRun", body)
      await child.wrap(() => next(index + 1))
    }

    await next(0)
  }

  return { run, wrap, result: () => ({ data, output: finalOutput }) }
}
