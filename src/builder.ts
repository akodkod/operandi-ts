// prettier-ignore
import { type ErrorMap, HookError, OperandiError, StepError, UnexpectedError, ValidationError } from "./errors"
import type { Definition, Prepared, Schema, Step } from "./runtime/definition"
import { mergeErrors } from "./runtime/error-factories"
import { execute } from "./runtime/execute"
import { createOperationResult } from "./runtime/result"
import { prepare } from "./runtime/validation"
import type { Action, ActionMiddleware, HookPhase } from "./types"

const definitions = new WeakMap<object, Definition>()

function create(definition: Definition): Action {
  // The public builder tracks accumulated types, runtime storage erases them
  const addHook = (phase: HookPhase, name: string, handler: Step["handler"]) => {
    if (!name.trim()) throw new TypeError("A hook needs a non-empty name")

    if (
      definition.steps.length > 0 &&
      ["beforeRun", "beforeStep", "afterStep", "aroundStep"].includes(phase)
    ) {
      throw new TypeError(`${phase} must be registered before steps`)
    }

    return create({
      ...definition,
      hooks: [...definition.hooks, { phase, name, handler, errors: definition.errors }],
    })
  }

  const operation = {
    beforeRun: (name: string, handler: Step["handler"]) => addHook("beforeRun", name, handler),
    afterRun: (name: string, handler: Step["handler"]) => addHook("afterRun", name, handler),
    aroundRun: (name: string, handler: Step["handler"]) => addHook("aroundRun", name, handler),
    beforeStep: (name: string, handler: Step["handler"]) => addHook("beforeStep", name, handler),
    afterStep: (name: string, handler: Step["handler"]) => addHook("afterStep", name, handler),
    aroundStep: (name: string, handler: Step["handler"]) => addHook("aroundStep", name, handler),
    errors(added: ErrorMap) {
      return create({ ...definition, errors: mergeErrors(definition.errors, added) })
    },
    use(middleware: object) {
      const child = definitions.get(middleware)

      if (child?.kind !== "middleware")
        throw new TypeError("Middleware must be created with createActionMiddleware")

      return create({
        ...definition,
        middleware: [...definition.middleware, child],
        errors: mergeErrors(definition.errors, child.errors),
      })
    },
    input: (schema: Schema) => create({ ...definition, inputSchema: schema }),
    output: (schema: Schema) => create({ ...definition, outputSchema: schema }),
    step(name: string, handler: Step["handler"]) {
      if (!name.trim()) throw new TypeError("A step needs a non-empty name")

      return create({
        ...definition,
        steps: [...definition.steps, { name, handler, errors: definition.errors }],
      })
    },
    async run(rawInput: unknown) {
      const prepared = await prepare(definition, rawInput)
      const { output } = await execute(prepared, new Set())
      return createOperationResult(prepared.input, output)
    },
    async runSafe(rawInput: unknown) {
      let prepared: Prepared | undefined
      const declaredErrors = new Set<OperandiError>()

      try {
        prepared = await prepare(definition, rawInput)
        const { output } = await execute(prepared, declaredErrors)
        return Object.assign(createOperationResult(prepared.input, output), { error: undefined })
      } catch (cause) {
        const error =
          cause instanceof ValidationError ||
          cause instanceof StepError ||
          cause instanceof HookError ||
          (cause instanceof OperandiError && declaredErrors.has(cause))
            ? cause
            : new UnexpectedError(cause)

        return { input: prepared?.input, output: undefined, error }
      }
    },
  }

  definitions.set(operation, definition)
  return operation as unknown as Action
}

export function createAction(actionName?: string): Action {
  return create({
    kind: "action",
    name: actionName,
    hooks: [],
    steps: [],
    middleware: [],
    errors: {},
  })
}

export function createActionMiddleware(middlewareName?: string): ActionMiddleware {
  return create({
    kind: "middleware",
    name: middlewareName,
    hooks: [],
    steps: [],
    middleware: [],
    errors: {},
  }) as unknown as ActionMiddleware
}
