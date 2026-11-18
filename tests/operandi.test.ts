import type { StandardSchemaV1 } from "../src/index"
import { createAction, StepError, ValidationError } from "../src/index"
import { type } from "arktype"
import { describe, expect, test } from "bun:test"
import * as v from "valibot"
import { z } from "zod"

describe("createAction", () => {
  test("runs the transaction flow in order with inferred data and output", async () => {
    const events: string[] = []

    const tx = {
      update: async () => {
        events.push("update")
      },
      commit: async () => {
        events.push("commit")
      },
    }

    const operation = createAction()
      .input(
        z.object({
          userId: z.int(),
          workspaceId: z.int(),
        }),
      )
      .output(
        z.object({
          success: z.boolean(),
        }),
      )
      .step("validate workspace", ({ input }) => {
        events.push(`validate ${input.workspaceId}`)
      })
      .step("open transaction", async () => {
        return { tx }
      })
      .step("complete", async ({ data }) => {
        await data.tx.update()
      })
      .step("commit transaction", async ({ data, setOutput }) => {
        await data.tx.commit()
        setOutput({ success: true })
      })

    expect(await operation.run({ userId: 1, workspaceId: 2 })).toEqual({
      input: { userId: 1, workspaceId: 2 },
      output: { success: true },
    })

    expect(events).toEqual(["validate 2", "update", "commit"])
  })

  test("supports Zod, Valibot, and ArkType", async () => {
    for (const schema of [
      z.object({ name: z.string() }),
      v.object({ name: v.string() }),
      type({ name: "string" }),
    ]) {
      const op = createAction()
        .input(schema)
        .output(schema)
        .step("echo", ({ input, setOutput }) => {
          return setOutput(input)
        })

      expect(await op.run({ name: "Ada" })).toEqual({
        input: { name: "Ada" },
        output: { name: "Ada" },
      })

      await expect(op.run({ name: 123 } as never)).rejects.toBeInstanceOf(ValidationError)
    }
  })

  test("uses schema transformations on both boundaries", async () => {
    const op = createAction()
      .input(z.string().transform(Number))
      .output(z.number().transform(String))
      .step("double", ({ input, setOutput }) => {
        return setOutput(input * 2)
      })

    expect(await op.run("21")).toEqual({ input: 21, output: "42" })
  })

  test("awaits asynchronous standard schema validation", async () => {
    const schema: StandardSchemaV1<string, number> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) =>
          typeof value === "string"
            ? { value: value.length }
            : { issues: [{ message: "Expected string" }] },
      },
    }

    expect(
      await createAction()
        .input(schema)
        .output(z.number())
        .step("echo", ({ input, setOutput }) => {
          return setOutput(input)
        })
        .run("abc"),
    ).toEqual({ input: 3, output: 3 })
  })

  test("fails before steps on invalid input and validates missing output", async () => {
    let called = false

    const op = createAction()
      .input(z.number())
      .step("work", () => {
        called = true
      })

    await expect(op.run("bad" as never)).rejects.toMatchObject({ phase: "input" })
    expect(called).toBe(false)

    await expect(
      createAction()
        .output(
          z.object({
            ok: z.boolean(),
          }),
        )
        .run(),
    ).rejects.toMatchObject({
      phase: "output",
    })

    expect(await createAction().output(z.string().default("default")).run()).toEqual({
      input: undefined,
      output: "default",
    })
  })

  test("wraps failed steps with name, index, and original cause; stops execution", async () => {
    const cause = new Error("database unavailable")
    let called = false

    const op = createAction()
      .step("fail", () => {
        throw cause
      })
      .step("later", () => {
        called = true
      })

    await expect(op.run()).rejects.toBeInstanceOf(StepError)
    await expect(op.run()).rejects.toMatchObject({ stepName: "fail", stepIndex: 0, cause })
    expect(called).toBe(false)
  })

  test("branches immutably and isolates concurrent runs", async () => {
    const base = createAction()
      .input(z.number())
      .output(z.number())
      .step("load", async ({ input }) => {
        return { count: input }
      })

    const first = base.step("first", ({ data, setOutput }) => {
      return setOutput(data.count + 1)
    })

    const second = base.step("second", ({ data, setOutput }) => {
      return setOutput(data.count + 2)
    })

    expect(await Promise.all([first.run(1), second.run(10), first.run(100)])).toEqual([
      { input: 1, output: 2 },
      { input: 10, output: 12 },
      { input: 100, output: 101 },
    ])
  })

  test("merges shallowly with last-write wins, including optional and union returns", async () => {
    const op = createAction()
      .step("initial", () => {
        return { count: 1, keep: true }
      })
      .step("replace", (): { count?: string } => {
        return {}
      })
      .step("check", ({ data }) => {
        expect(data).toEqual({ count: 1, keep: true })
        return { count: "two" }
      })
      .step("check replacement", ({ data }) => {
        expect(data.count).toBe("two")
      })

    expect(await op.run()).toEqual({ input: undefined, output: undefined })
  })

  test("rejects invalid runtime returns and blank names", async () => {
    expect(() =>
      // eslint-disable-next-line operandi/step-name-starts-with-lowercase -- Exercise runtime rejection of a blank name
      createAction().step(" ", () => {
        return undefined
      }),
    ).toThrow(TypeError)

    for (const value of [null, 1, [], new Date()]) {
      await expect(
        createAction()
          .step("invalid", () => {
            return value as never
          })
          .run(),
      ).rejects.toMatchObject({
        cause: expect.any(TypeError),
      })
    }
  })

  test("last setOutput replaces the entire output and final validation runs", async () => {
    const op = createAction()
      .output(z.number())
      .step("set", ({ setOutput }) => {
        setOutput(1)
        setOutput(2)
      })

    expect(await op.run()).toEqual({ input: undefined, output: 2 })

    await expect(
      createAction()
        .output(z.number())
        .step("invalid", ({ setOutput }) => {
          return setOutput("bad" as never)
        })
        .run(),
    ).rejects.toMatchObject({ phase: "output" })
  })
})

test("returns parsed defaults and stripped input with asynchronously transformed output", async () => {
  const action = createAction()
    .input(
      z.object({
        name: z.string().default("Ada"),
      }),
    )
    .output(
      z.number().transform(async (value) => {
        await Promise.resolve()
        return `length: ${value}`
      }),
    )
    .step("length", async ({ input, setOutput }) => {
      await Promise.resolve()
      setOutput(input.name.length)
    })

  const rawInput = { extra: "stripped" }
  const result = await action.run(rawInput as { name?: string })
  expect(result).toEqual({ input: { name: "Ada" }, output: "length: 3" })
  expect(rawInput).toEqual({ extra: "stripped" })
})

test("returns both properties when neither schema is configured", async () => {
  const result = await createAction().run()
  expect(result).toEqual({ input: undefined, output: undefined })
  expect(Object.keys(result)).toEqual(["input", "output"])
})
