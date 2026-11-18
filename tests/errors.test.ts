import {
  createAction,
  createActionMiddleware,
  OperandiError,
  StepError,
  UnexpectedError,
  ValidationError,
} from "../src/index"
import { type } from "arktype"
import { expect, test } from "bun:test"
import * as v from "valibot"
import { z } from "zod"

test("run throws a declared error directly; runSafe stores it and preserves validated input", async () => {
  const cause = new Error("lookup failed")
  let later = false
  const action = createAction()
    .errors({ NOT_FOUND: { message: "Missing user", data: z.object({ userId: z.number() }) } })
    .input(
      z.object({
        userId: z.string().transform(Number),
      }),
    )
    .step("lookup", ({ input, errors }) => {
      throw errors.NOT_FOUND({ data: input, cause })
    })
    .step("later", () => {
      later = true
    })
  await expect(action.run({ userId: "7" })).rejects.toBeInstanceOf(OperandiError)
  await expect(action.run({ userId: "7" })).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Missing user",
    data: { userId: 7 },
    cause,
  })
  const result = await action.runSafe({ userId: "7" })
  expect(result.input).toEqual({ userId: 7 })
  expect(result.output).toBeUndefined()
  expect(result.error).toBeInstanceOf(OperandiError)
  expect(result.error).toMatchObject({ code: "NOT_FOUND", data: { userId: 7 }, cause })
  expect(later).toBe(false)
})

test("runSafe succeeds with the same input/output as run", async () => {
  const action = createAction()
    .input(z.number())
    .output(z.string())
    .step("format", ({ input, setOutput }) => {
      return setOutput(String(input))
    })
  expect(await action.runSafe(42)).toEqual({ ...(await action.run(42)), error: undefined })
  expect(await createAction().runSafe()).toEqual({
    input: undefined,
    output: undefined,
    error: undefined,
  })
})

test("error factories support no data, default messages, overrides, and async transformations", async () => {
  const simple = createAction()
    .errors({ DENIED: { message: "Access denied" } })
    .step("deny", ({ errors }) => {
      throw errors.DENIED({ message: "Custom message" })
    })
  expect((await simple.runSafe()).error).toMatchObject({
    code: "DENIED",
    message: "Custom message",
    data: undefined,
  })
  const transformed = createAction()
    .errors({ RETRY: { data: z.string().transform(async (value) => Number(value)) } })
    .step("retry", ({ errors }) => {
      throw errors.RETRY({ data: "10" })
    })
  expect((await transformed.runSafe()).error).toMatchObject({
    code: "RETRY",
    message: "RETRY",
    data: 10,
  })
  const defaults = createAction()
    .errors({ RETRY: { data: z.number().default(5) } })
    .step("retry", ({ errors }) => {
      throw errors.RETRY()
    })
  expect((await defaults.runSafe()).error).toMatchObject({ data: 5 })
})

test("error data supports all three schema libraries and rejects invalid runtime data", async () => {
  for (const schema of [
    z.object({ id: z.number() }),
    v.object({ id: v.number() }),
    type({ id: "number" }),
  ]) {
    const base = createActionMiddleware().errors({ MISSING: { data: schema } })
    const valid = base.step("valid", ({ errors }) => {
      throw errors.MISSING({ data: { id: 1 } })
    })
    expect((await valid.runSafe()).error).toMatchObject({ code: "MISSING", data: { id: 1 } })
    const invalid = base.step("invalid", ({ errors }) => {
      throw errors.MISSING({ data: { id: "bad" } as never })
    })
    await expect(invalid.run()).rejects.toBeInstanceOf(ValidationError)
    expect((await invalid.runSafe()).error).toMatchObject({ phase: "error" })
  }
})

test("nested middleware errors merge into the action and are available to its steps", async () => {
  const auth = createActionMiddleware()
    .errors({ UNAUTHORIZED: {} })
    .input(
      z.object({
        userId: z.number(),
      }),
    )
    .step("auth", ({ input, errors }) => {
      if (input.userId === 0) throw errors.UNAUTHORIZED()
    })
  const nested = createActionMiddleware().use(auth).errors({ BLOCKED: {} })
  const action = createAction()
    .use(nested)
    .errors({ MISSING: { data: z.string() } })
    .step("action", ({ input, errors }) => {
      if (input.userId === 1) throw errors.BLOCKED()
      if (input.userId === 2) throw errors.MISSING({ data: "user" })
    })
  expect((await action.runSafe({ userId: 0 })).error).toMatchObject({ code: "UNAUTHORIZED" })
  expect((await action.runSafe({ userId: 1 })).error).toMatchObject({ code: "BLOCKED" })
  expect((await action.runSafe({ userId: 2 })).error).toMatchObject({
    code: "MISSING",
    data: "user",
  })
  expect((await action.runSafe({ userId: 3 })).error).toBeUndefined()
})

test("safe failures distinguish invalid input, output, unexpected throws, and undeclared errors", async () => {
  const invalidInput = await createAction()
    .input(z.number())
    .runSafe("bad" as never)
  expect(invalidInput.input).toBeUndefined()
  expect(invalidInput.error).toMatchObject({ phase: "input" })
  const invalidOutput = await createAction().input(z.number()).output(z.string()).runSafe(1)
  expect(invalidOutput.input).toBe(1)
  expect(invalidOutput.output).toBeUndefined()
  expect(invalidOutput.error).toMatchObject({ phase: "output" })
  for (const cause of [
    new Error("boom"),
    undefined,
    null,
    "failed",
    new OperandiError("UNDECLARED", undefined),
  ]) {
    const action = createAction().step("throw", () => {
      throw cause
    })
    await expect(action.run()).rejects.toBeInstanceOf(StepError)
    expect((await action.runSafe()).error).toMatchObject({ name: "StepError", cause })
  }
  const cause = new Error("validator failed")
  const action = createAction().input(
    z.string().transform(() => {
      throw cause
    }),
  )
  await expect(action.run("hello")).rejects.toBe(cause)
  expect((await action.runSafe("hello")).error).toBeInstanceOf(UnexpectedError)
  expect((await action.runSafe("hello")).error).toMatchObject({ cause })
})

test("manually constructed matching errors are validated; duplicate declarations are rejected", async () => {
  const action = createAction()
    .errors({ MISSING: { data: z.number() } })
    .step("utility", () => {
      throw new OperandiError("MISSING", 1)
    })
  expect((await action.runSafe()).error).toMatchObject({ code: "MISSING", data: 1 })
  const base = createActionMiddleware().errors({ MISSING: {} })
  expect(() => base.errors({ MISSING: {} })).toThrow("Duplicate error code")
  expect(() => base.use(base as never)).toThrow("Duplicate error code")
})

test("branching and concurrent safe runs do not share failures", async () => {
  const base = createActionMiddleware()
    .errors({ DENIED: { data: z.number() } })
    .input(z.number())
  const action = base.step("check", async ({ input, errors }) => {
    await Promise.resolve()
    if (input < 0) throw errors.DENIED({ data: input })
  })
  const [failed, succeeded, untouched] = await Promise.all([
    action.runSafe(-1),
    action.runSafe(1),
    base.runSafe(-1),
  ])
  expect(failed.error).toMatchObject({ code: "DENIED", data: -1 })
  expect(succeeded.error).toBeUndefined()
  expect(untouched.error).toBeUndefined()
})
