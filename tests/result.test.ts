import { createAction, isOperationResult } from "../src/index"
import { expect, test } from "bun:test"
import { z } from "zod"

const action = createAction()
  .input(z.string().transform(Number))
  .output(z.number().transform(String))
  .step("echo", ({ input, setOutput }) => {
    setOutput(input)
  })

test("recognizes validated run and successful runSafe results", async () => {
  const result = await action.run("42")
  const safe = await action.runSafe("42")

  for (const value of [result, safe]) {
    expect(isOperationResult(value)).toBe(true)
    expect(value.input).toBe(42)
    expect(value.output).toBe("42")
    expect(JSON.stringify(value)).toBe('{"input":42,"output":"42"}')

    expect(
      Object.getOwnPropertyDescriptor(value, Symbol.for("operandi.OperationResult.v1")),
    ).toMatchObject({
      value: true,
      enumerable: false,
    })
  }

  expect(Object.keys(result)).toEqual(["input", "output"])
  expect(Object.keys(safe)).toEqual(["input", "output", "error"])
})

test("does not brand failed safe results", async () => {
  const failures = [
    await action.runSafe("invalid"),
    await createAction().output(z.number()).runSafe(),
    await createAction()
      .step("fail", () => {
        throw new Error("failed")
      })
      .runSafe(),
  ]

  for (const result of failures) {
    expect(result.error).toBeDefined()
    expect(isOperationResult(result)).toBe(false)
    expect(Object.getOwnPropertySymbols(result)).toEqual([])
  }
})

test("rejects unbranded values and incorrect brand values", () => {
  for (const value of [
    { input: 1, output: 2 },
    null,
    undefined,
    false,
    1,
    1n,
    "result",
    Symbol(),
    () => {},
    { [Symbol.for("operandi.OperationResult.v1")]: false },
  ]) {
    expect(isOperationResult(value)).toBe(false)
  }
})

test("supports undefined output without changing JSON", async () => {
  for (const result of [await createAction().run(), await createAction().runSafe()]) {
    expect(isOperationResult(result)).toBe(true)
    expect(result.output).toBeUndefined()
    expect(JSON.stringify(result)).toBe("{}")
  }
})

test("recognizes the shared symbol across package copies", () => {
  const result = {
    input: undefined,
    output: undefined,
    [Symbol.for("operandi.OperationResult.v1")]: true,
  }

  expect(isOperationResult(result)).toBe(true)
})
