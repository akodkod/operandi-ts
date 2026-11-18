import { createAction, createActionMiddleware, type OperationResult } from "../src/index"
import { z } from "zod"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

function assertType<_T extends true>() {}

const operation = createAction()
  .input(z.string().transform(Number))
  .output(z.number().transform(String))
  .step("create", ({ input, data, setOutput }) => {
    assertType<Equal<typeof input, number>>()
    // @ts-expect-error Future step data is unavailable
    void data.tx
    // @ts-expect-error Output setter accepts the schema's input, not its transformed output
    setOutput("wrong")

    return { tx: { commit: async () => {} }, count: 1 }
  })
  .step("overwrite", () => {
    return { count: "new" }
  })
  .step("use", async ({ data, setOutput }) => {
    assertType<Equal<typeof data.count, string>>()
    await data.tx.commit()
    setOutput(42)
    // @ts-expect-error Data is readonly, return an object to extend it
    data.count = "mutated"
  })

assertType<Equal<ReturnType<typeof operation.run>, Promise<OperationResult<number, string>>>>()
// @ts-expect-error Input is required
operation.run()
// @ts-expect-error Caller passes schema input, not transformed number
operation.run(42)
// @ts-expect-error Cannot change the input schema after defining steps
operation.input(z.number())
// @ts-expect-error Cannot change the output schema after defining steps
operation.output(z.string())

// @ts-expect-error Step results must be objects or void
createAction().step("primitive", () => {
  return 42
})

// @ts-expect-error Arrays are not step data objects
createAction().step("array", () => {
  return [1, 2]
})

createAction().step("no output", ({ setOutput }) => {
  // @ts-expect-error No output setter without an output schema
  setOutput(1)
})

createAction()
  .step("base", () => {
    return { count: 1 }
  })
  .step("optional", (): { count?: string } => {
    return {}
  })
  .step("use", ({ data }) => {
    assertType<Equal<typeof data.count, number | string | undefined>>()
  })

createAction()
  .step("conditional", (): { value: number } | void => {
    return undefined
  })
  .step("use", ({ data }) => {
    // @ts-expect-error A conditional return does not guarantee this field exists
    data.value.toFixed()
  })

createAction().input(z.string().optional()).run()

const withUser = createActionMiddleware()
  .input(
    z.object({
      userId: z.number(),
    }),
  )
  .output(
    z.object({
      authenticated: z.boolean(),
    }),
  )
  .step("authenticate", ({ input, setOutput }) => {
    setOutput({ authenticated: true })
    return { user: { id: input.userId } }
  })

const withMessage = createAction()
  .use(withUser)
  .input(
    z.object({
      message: z.string(),
    }),
  )
  .output(
    z.object({
      length: z.number(),
    }),
  )
  .step("message", ({ input, data, setOutput }) => {
    assertType<Equal<typeof input, { userId: number; message: string }>>()
    assertType<Equal<typeof data.user.id, number>>()
    setOutput({ length: input.message.length })
    // @ts-expect-error Middleware output is set by its own steps
    setOutput({ authenticated: true })
  })

assertType<
  Equal<
    ReturnType<typeof withMessage.run>,
    Promise<
      OperationResult<
        { userId: number; message: string },
        { authenticated: boolean; length: number }
      >
    >
  >
>()

withMessage.run({ userId: 1, message: "hello" })
// @ts-expect-error Middleware input remains required
withMessage.run({ message: "hello" })
// @ts-expect-error Action input remains required
withMessage.run({ userId: 1 })
// @ts-expect-error Middleware composition requires object schemas
createAction().use(createActionMiddleware().input(z.string()))
// @ts-expect-error Middleware composition requires object output schemas
createAction().use(createActionMiddleware().output(z.string()))
// @ts-expect-error Cannot merge an object middleware input with a scalar action input
createAction().use(withUser).input(z.string())
// @ts-expect-error Cannot merge an object middleware output with a scalar action output
createAction().use(withUser).output(z.string())
// @ts-expect-error Middleware is configured before local schemas or steps
withMessage.use(withUser)

const middlewareOnly = createAction().use(withUser)

assertType<
  Equal<
    ReturnType<typeof middlewareOnly.run>,
    Promise<OperationResult<{ userId: number }, { authenticated: boolean }>>
  >
>()

const transformedMiddleware = createActionMiddleware().input(
  z.object({
    value: z.string().transform(Number),
  }),
)

createAction()
  .use(transformedMiddleware)
  .input(
    z.object({
      value: z.string().transform((s) => s.length > 0),
    }),
  )
  .step("override", ({ input }) => {
    assertType<Equal<typeof input.value, boolean>>()
  })

async function checkOperationResult() {
  const result = await withMessage.run({ userId: 1, message: "hello" })

  assertType<Equal<typeof result.input, { userId: number; message: string }>>()
  assertType<Equal<typeof result.output, { authenticated: boolean; length: number }>>()
  // @ts-expect-error Unknown input properties are not available
  void result.input.unknown
  // @ts-expect-error Unknown output properties are not available
  void result.output.unknown
  // @ts-expect-error Result is not the output itself
  void result.authenticated
  // @ts-expect-error Run result properties cannot be reassigned
  result.input = { userId: 2, message: "changed" }

  const transformed = await operation.run("42")

  assertType<Equal<typeof transformed.input, number>>()

  assertType<Equal<typeof transformed.output, string>>()
  const empty = await createAction().run()

  assertType<Equal<typeof empty.input, void>>()

  assertType<Equal<typeof empty.output, void>>()
  const optional = await createAction().input(z.string().optional()).run()

  assertType<Equal<typeof optional.input, string | undefined>>()

  // @ts-expect-error Await the completed run before accessing its result
  void withMessage.run({ userId: 1, message: "hello" }).input
}

void checkOperationResult

const authErrors = createActionMiddleware().errors({ UNAUTHORIZED: {} })

const errorAction = createAction()
  .use(authErrors)
  .input(
    z.object({
      id: z.number(),
    }),
  )
  .output(z.string())
  .errors({
    MISSING: { data: z.object({ id: z.number() }) },
    RETRY: { data: z.string().transform(Number) },
  })
  .step("errors", ({ errors, setOutput }) => {
    errors.UNAUTHORIZED()
    errors.MISSING({ data: { id: 1 } })
    errors.RETRY({ data: "5" })
    // @ts-expect-error Unknown error code
    errors.UNKNOWN()
    // @ts-expect-error Required error payload cannot be omitted
    errors.MISSING()
    // @ts-expect-error Wrong error payload type
    errors.MISSING({ data: { id: "wrong" } })
    // @ts-expect-error Error factories accept raw schema input
    errors.RETRY({ data: 5 })
    // @ts-expect-error No data declared for this error
    errors.UNAUTHORIZED({ data: 1 })
    setOutput("done")
  })

async function checkSafeErrors() {
  const result = await errorAction.runSafe({ id: 1 })

  if (result.error) {
    assertType<Equal<typeof result.output, undefined>>()
    assertType<Equal<typeof result.input, { id: number } | undefined>>()

    if (result.error.code === "MISSING") {
      assertType<Equal<typeof result.error.data, { id: number }>>()
      // @ts-expect-error Only the declared data is available
      void result.error.data.other
    } else if (result.error.code === "RETRY") {
      assertType<Equal<typeof result.error.data, number>>()
    } else if (result.error.code === "UNAUTHORIZED") {
      assertType<Equal<typeof result.error.data, undefined>>()
    }
  } else {
    assertType<Equal<typeof result.input, { id: number }>>()
    assertType<Equal<typeof result.output, string>>()
  }

  // @ts-expect-error Safe execution still requires the input
  errorAction.runSafe()
  // @ts-expect-error Safe execution still checks input types
  errorAction.runSafe({ id: "wrong" })
}

void checkSafeErrors

const lifecycle = createAction("Named action")
  .beforeRun("start", () => {
    return { startTime: 1 }
  })
  .afterRun("duration", ({ data }) => {
    assertType<Equal<typeof data.startTime, number>>()
  })
  .aroundRun("trace", async ({ actionName, run }) => {
    assertType<Equal<typeof actionName, string | undefined>>()
    await run()
  })
  .input(
    z.object({
      message: z.string(),
    }),
  )
  .beforeStep("start step", ({ input, data }) => {
    assertType<Equal<typeof input.message, string>>()
    assertType<Equal<typeof data.startTime, number>>()
    return { stepStart: 2 }
  })
  .afterStep("observe", ({ data, stepName }) => {
    assertType<Equal<typeof data.stepStart, number>>()
    assertType<Equal<typeof stepName, string>>()
  })
  .aroundStep("trace step", async ({ runStep, stepName, data }) => {
    assertType<Equal<typeof stepName, string>>()
    assertType<Equal<typeof data.stepStart, number | undefined>>()
    await runStep()
  })
  .step("work", ({ data }) => {
    assertType<Equal<typeof data.stepStart, number>>()
    return { finished: true }
  })
  .afterRun("observe work", ({ data }) => {
    assertType<Equal<typeof data.finished, boolean>>()
  })

// @ts-expect-error afterRun does not produce data
createAction().afterRun("bad", () => {
  return { unused: true }
})

// @ts-expect-error Async afterRun does not produce data either
createAction().afterRun("bad", async () => {
  return { unused: true }
})

// @ts-expect-error afterStep does not produce data
createAction().afterStep("bad", () => {
  return { unused: true }
})

// @ts-expect-error Async afterStep does not produce data either
createAction().afterStep("bad", async () => {
  return { unused: true }
})

// @ts-expect-error Lifecycle setup hooks must precede steps
lifecycle.beforeRun("late", () => {
  return undefined
})

// @ts-expect-error Actions cannot be used as middleware
createAction().use(createAction())

createAction().beforeRun("data", ({ data }) => {
  // @ts-expect-error A beforeRun cannot depend on later step data
  void data.finished
})

createAction()
  .beforeStep("data", () => {
    return { stepStart: 1 }
  })
  .afterRun("no steps", ({ data }) => {
    // @ts-expect-error With no steps, beforeStep has not run
    void data.stepStart
  })

createAction().aroundRun("trace", async ({ run, data }) => {
  // @ts-expect-error Unknown data is unavailable
  void data.missing
  await run()
})
