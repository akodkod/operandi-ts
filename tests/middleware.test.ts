import { createAction, createActionMiddleware } from "../src/index"
import { type } from "arktype"
import { expect, test } from "bun:test"
import * as v from "valibot"
import { z } from "zod"

test("rejects objects and actions passed as middleware", () => {
  for (const middleware of [{}, createAction()]) {
    expect(() => createAction().use(middleware as never)).toThrow(
      new TypeError("Middleware must be created with createActionMiddleware"),
    )
  }
})

test("rejects non-object input merges before any steps execute", async () => {
  for (const value of [null, 1, "input", [], new Date(0)]) {
    for (const invalidFirst of [true, false]) {
      let calls = 0
      const invalid = z.unknown().transform(() => value)
      const valid = z.unknown().transform(() => ({ valid: true }))

      const middleware = createActionMiddleware()
        .input((invalidFirst ? invalid : valid) as never)
        .step("middleware", () => {
          calls++
        })

      const action = createAction()
        .use(middleware)
        .input((invalidFirst ? valid : invalid) as never)
        .step("action", () => {
          calls++
        })

      await expect(action.run({} as never)).rejects.toThrow(
        new TypeError("Middleware input and output must be plain objects"),
      )

      expect(calls).toBe(0)
    }
  }
})

test("rejects non-object output merges", async () => {
  for (const value of [null, 1, "output", [], new Date(0)]) {
    for (const invalidFirst of [true, false]) {
      const invalid = z.unknown().transform(() => value)
      const valid = z.unknown().transform(() => ({ valid: true }))
      const middleware = createActionMiddleware().output((invalidFirst ? invalid : valid) as never)

      const action = createAction()
        .use(middleware)
        .output((invalidFirst ? valid : invalid) as never)

      await expect(action.run()).rejects.toThrow(
        new TypeError("Middleware input and output must be plain objects"),
      )
    }
  }
})

test("middleware merges user input, output, and data with an action", async () => {
  const events: string[] = []

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
      events.push(`user ${input.userId}`)
      setOutput({ authenticated: true })
      return { user: { id: input.userId } }
    })

  const action = createAction()
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
    .step("my step", ({ input, data, setOutput }) => {
      events.push(`${input.userId}: ${input.message}`)
      expect(data.user.id).toBe(input.userId)
      setOutput({ length: input.message.length })
    })

  expect(await action.run({ userId: 1, message: "hello" })).toEqual<unknown>({
    input: { userId: 1, message: "hello" },
    output: { authenticated: true, length: 5 },
  })

  expect(events).toEqual(["user 1", "1: hello"])

  expect(await withUser.run({ userId: 2 })).toEqual<unknown>({
    input: { userId: 2 },
    output: { authenticated: true },
  })
})

test("validates every input before any middleware side effects", async () => {
  let calls = 0

  const middleware = createActionMiddleware()
    .input(
      z.object({
        userId: z.number(),
      }),
    )
    .step("effect", () => {
      calls++
    })

  const action = createAction()
    .use(middleware)
    .input(
      z.object({
        message: z.string(),
      }),
    )

  await expect(action.run({ message: "hi" } as never)).rejects.toMatchObject({ phase: "input" })
  await expect(action.run({ userId: 1 } as never)).rejects.toMatchObject({ phase: "input" })
  expect(calls).toBe(0)
})

test("composes nested and multiple middleware across schema libraries", async () => {
  const order: string[] = []

  const user = createActionMiddleware()
    .input(v.object({ userId: v.number() }))
    .step("user", () => {
      order.push("user")
      return { a: 1 }
    })

  const workspace = createActionMiddleware()
    .use(user)
    .input(type({ workspaceId: "number" }))
    .step("workspace", ({ input, data }) => {
      expect(input.userId).toBe(1)
      expect(data.a).toBe(1)
      order.push("workspace")
      return { b: 2 }
    })

  const audit = createActionMiddleware()
    .output(
      z.object({
        audited: z.boolean(),
      }),
    )
    .step("audit", ({ setOutput }) => {
      order.push("audit")
      setOutput({ audited: true })
    })

  const action = createAction()
    .use(workspace)
    .use(audit)
    .input(
      z.object({
        message: z.string(),
      }),
    )
    .step("action", ({ input, data }) => {
      expect(input).toEqual({ userId: 1, workspaceId: 2, message: "hi" })
      expect(data).toEqual({ a: 1, b: 2 })
      order.push("action")
    })

  expect(await action.run({ userId: 1, workspaceId: 2, message: "hi" })).toEqual<unknown>({
    input: { userId: 1, workspaceId: 2, message: "hi" },
    output: { audited: true },
  })

  expect(order).toEqual(["user", "workspace", "audit", "action"])
})

test("isolates transformed inputs and outputs; later fields win in the action", async () => {
  const middleware = createActionMiddleware()
    .input(
      z.object({
        value: z.string().transform(Number),
      }),
    )
    .output(
      z.object({
        value: z.number().transform(String),
      }),
    )
    .step("middleware", ({ input, setOutput }) => {
      expect(input.value).toBe(42)
      setOutput({ value: input.value })
    })

  const action = createAction()
    .use(middleware)
    .input(
      z.object({
        value: z.string().transform((s) => s.length),
      }),
    )
    .output(
      z.object({
        value: z.boolean(),
      }),
    )
    .step("action", ({ input, setOutput }) => {
      expect(input.value).toBe(2)
      setOutput({ value: true })
    })

  expect(await action.run({ value: "42" })).toEqual<unknown>({
    input: { value: 2 },
    output: { value: true },
  })
})

test("middleware failures stop the action, including invalid output", async () => {
  let called = false

  const missingOutput = createActionMiddleware().output(
    z.object({
      required: z.string(),
    }),
  )

  await expect(
    createAction()
      .use(missingOutput)
      .step("action", () => {
        called = true
      })
      .run(),
  ).rejects.toMatchObject({ phase: "output" })

  const cause = new Error("unauthorized")

  const failure = createActionMiddleware().step("authenticate", () => {
    throw cause
  })

  await expect(
    createAction()
      .use(failure)
      .step("action", () => {
        called = true
      })
      .run(),
  ).rejects.toMatchObject({ stepName: "authenticate", cause })

  expect(called).toBe(false)
})

test("middleware can be reused, branched, and executed concurrently", async () => {
  const middleware = createActionMiddleware()
    .input(
      z.object({
        userId: z.number(),
      }),
    )
    .output(
      z.object({
        userId: z.number(),
      }),
    )
    .step("user", async ({ input, setOutput }) => {
      await Promise.resolve()
      setOutput(input)
    })

  const base = createAction().use(middleware)

  const first = base
    .output(
      z.object({
        tag: z.string(),
      }),
    )
    .step("first", ({ setOutput }) => {
      return setOutput({ tag: "first" })
    })

  const second = base
    .output(
      z.object({
        tag: z.string(),
      }),
    )
    .step("second", ({ setOutput }) => {
      return setOutput({ tag: "second" })
    })

  expect(
    await Promise.all([
      first.run({ userId: 1 }),
      second.run({ userId: 2 }),
      base.run({ userId: 3 }),
    ]),
  ).toEqual<unknown>([
    { input: { userId: 1 }, output: { userId: 1, tag: "first" } },
    { input: { userId: 2 }, output: { userId: 2, tag: "second" } },
    { input: { userId: 3 }, output: { userId: 3 } },
  ])
})

test("schema-less middleware and middleware-only actions work", async () => {
  const middleware = createActionMiddleware().step("resource", () => {
    return { resource: 1 }
  })

  await createAction()
    .use(middleware)
    .step("action", ({ data }) => {
      expect(data.resource).toBe(1)
    })
    .run()

  expect(
    await createAction()
      .use(
        createActionMiddleware().input(
          z.object({
            userId: z.number(),
          }),
        ),
      )
      .run({ userId: 1 }),
  ).toEqual<unknown>({ input: { userId: 1 }, output: undefined })
})
