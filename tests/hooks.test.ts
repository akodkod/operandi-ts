import {
  createAction,
  createActionMiddleware,
  HookError,
  OperandiError,
  StepError,
} from "../src/index"
import { expect, test } from "bun:test"
import { z } from "zod"

test("rejects hooks that must be registered before steps", () => {
  for (const phase of ["beforeRun", "beforeStep", "afterStep", "aroundStep"] as const) {
    const action = createAction().step("work", () => {
      return undefined
    }) as unknown as ReturnType<typeof createAction>
    expect(() => action[phase]("late", () => {})).toThrow(
      new TypeError(`${phase} must be registered before steps`),
    )
  }
})

test("runs all lifecycle phases in order and nests wrappers", async () => {
  const events: string[] = []
  const action = createAction("Named action")
    .input(z.number())
    .output(z.number())
    .beforeRun("start", ({ actionName }) => {
      expect(actionName).toBe("Named action")
      events.push("before run")
      return { startTime: 100 }
    })
    .afterRun("duration", ({ data }) => {
      expect(data.startTime).toBe(100)
      events.push("after run")
    })
    .aroundRun("outer", async ({ run, actionName, data }) => {
      expect(actionName).toBe("Named action")
      expect(data.startTime).toBeUndefined()
      events.push("outer enter")
      await run()
      events.push("outer exit")
    })
    .aroundRun("inner", async ({ run }) => {
      events.push("inner enter")
      await run()
      events.push("inner exit")
    })
    .beforeStep("start step", ({ stepName, stepIndex }) => {
      events.push(`before ${stepName}`)
      return { stepStarted: stepIndex }
    })
    .afterStep("finish step", ({ stepName, data }) => {
      events.push(`after ${stepName}`)
      expect(data.startTime).toBe(100)
    })
    .aroundStep("step span", async ({ stepName, runStep }) => {
      events.push(`enter ${stepName}`)
      await runStep()
      events.push(`exit ${stepName}`)
    })
    .step("first", ({ input, data }) => {
      expect(data.stepStarted).toBe(0)
      events.push("first")
      return { doubled: input * 2 }
    })
    .step("second", ({ data, setOutput }) => {
      expect(data.stepStarted).toBe(1)
      events.push("second")
      setOutput(data.doubled)
    })
  expect(await action.run(3)).toEqual({ input: 3, output: 6 })
  expect(events).toEqual([
    "outer enter",
    "inner enter",
    "before run",
    "enter first",
    "before first",
    "first",
    "after first",
    "exit first",
    "enter second",
    "before second",
    "second",
    "after second",
    "exit second",
    "after run",
    "inner exit",
    "outer exit",
  ])
})

test("after hooks return nothing; runtime rejects values from untyped callbacks", async () => {
  for (const phase of ["afterRun", "afterStep"] as const) {
    const base = createAction()
    const action = base[phase]("invalid", () => ({ unused: true }) as never).step("work", () => {})
    await expect(action.run()).rejects.toBeInstanceOf(HookError)
    expect((await action.runSafe()).error).toMatchObject({
      phase,
      hookName: "invalid",
      cause: expect.any(TypeError),
    })
  }
})

test("before hooks chain their data and afterRun can observe completed step data", async () => {
  const action = createAction()
    .beforeRun("first", () => {
      return { first: 1 }
    })
    .beforeRun("second", ({ data }) => {
      return { second: data.first + 1 }
    })
    .beforeStep("third", ({ data }) => {
      return { third: data.second + 1 }
    })
    .beforeStep("fourth", ({ data }) => {
      return { fourth: data.third + 1 }
    })
    .step("work", ({ data }) => {
      return { fifth: data.fourth + 1 }
    })
    .afterRun("check", ({ data }) => {
      expect(data.fifth).toBe(5)
    })
  await action.run()
})

test("after hooks skip failures and around hooks can clean up in finally", async () => {
  const events: string[] = []
  const cause = new Error("failed step")
  const action = createAction()
    .afterRun("after run", () => {
      events.push("after run")
    })
    .afterStep("after step", () => {
      events.push("after step")
    })
    .aroundRun("cleanup run", async ({ run }) => {
      try {
        await run()
      } finally {
        events.push("cleanup run")
      }
    })
    .aroundStep("cleanup step", async ({ runStep }) => {
      try {
        await runStep()
      } finally {
        events.push("cleanup step")
      }
    })
    .step("fail", () => {
      throw cause
    })
  await expect(action.run()).rejects.toBeInstanceOf(StepError)
  expect(events).toEqual(["cleanup step", "cleanup run"])
})

test("hook failures and declared errors retain their identity through wrappers", async () => {
  const cause = new Error("hook failed")
  const action = createAction("Failures")
    .aroundRun("wrap", async ({ run }) => {
      await run()
    })
    .beforeStep("broken", () => {
      throw cause
    })
    .step("work", () => {
      return undefined
    })
  expect((await action.runSafe()).error).toMatchObject({
    name: "HookError",
    phase: "beforeStep",
    hookName: "broken",
    actionName: "Failures",
    stepName: "work",
    cause,
  })
  const declared = createAction()
    .errors({ DENIED: { data: z.number() } })
    .aroundRun("wrap", async ({ run }) => {
      await run()
    })
    .beforeRun("deny", ({ errors }) => {
      throw errors.DENIED({ data: 1 })
    })
  await expect(declared.run()).rejects.toBeInstanceOf(OperandiError)
  expect((await declared.runSafe()).error).toMatchObject({ code: "DENIED", data: 1 })
})

test("continuations must run once and cannot hide inner failures", async () => {
  const skipped = createAction().aroundRun("skip", () => {
    return undefined
  })
  expect((await skipped.runSafe()).error).toMatchObject({
    phase: "aroundRun",
    cause: expect.any(TypeError),
  })
  let executions = 0
  const twice = createAction()
    .aroundStep("twice", async ({ runStep }) => {
      await runStep()
      await runStep()
    })
    .step("work", () => {
      executions++
    })
  expect((await twice.runSafe()).error).toMatchObject({ phase: "aroundStep" })
  expect(executions).toBe(1)
  const swallowed = createAction()
    .aroundRun("swallow", async ({ run }) => {
      try {
        await run()
      } catch {
        /* Deliberately try to hide the failure */
      }
    })
    .step("fail", () => {
      throw new Error("original")
    })
  expect((await swallowed.runSafe()).error).toMatchObject({ name: "StepError", stepName: "fail" })
})

test("awaits continuations even if a wrapper forgets to await them", async () => {
  let done = false
  const action = createAction()
    .aroundRun("unawaited", ({ run }) => {
      void run()
    })
    .step("async work", async () => {
      await Promise.resolve()
      done = true
    })
  await action.run()
  expect(done).toBe(true)
})

test("runSafe runs the same hooks and concurrent runs own their data", async () => {
  const seen: number[] = []
  const base = createAction()
    .input(z.number())
    .beforeRun("start", ({ input }) => {
      return { requestId: input }
    })
  const action = base
    .step("work", async ({ input, data }) => {
      await Promise.resolve()
      expect(data.requestId).toBe(input)
    })
    .afterRun("record", ({ data }) => {
      seen.push(data.requestId)
    })
  const results = await Promise.all([action.runSafe(1), action.runSafe(2), base.runSafe(3)])
  expect(results.every((result) => result.error === undefined)).toBe(true)
  expect(seen.sort()).toEqual([1, 2])
})

test("middleware hooks have their own name and data plus the consuming action name", async () => {
  const middleware = createActionMiddleware("Authentication")
    .input(
      z.object({
        userId: z.number(),
      }),
    )
    .beforeRun("middleware start", ({ actionName, middlewareName }) => {
      expect(actionName).toBe("Send message")
      expect(middlewareName).toBe("Authentication")
      return { authenticated: true }
    })
    .afterRun("middleware end", ({ data }) => {
      expect(data.authenticated).toBe(true)
    })
  const action = createAction("Send message")
    .use(middleware)
    .step("send", ({ data }) => {
      expect(data.authenticated).toBe(true)
    })
  await action.run({ userId: 1 })
})

test("empty and invalid runs have consistent lifecycle behavior", async () => {
  const events: string[] = []
  const action = createAction()
    .input(z.number())
    .beforeRun("before", () => {
      events.push("before")
    })
    .afterRun("after", () => {
      events.push("after")
    })
    .beforeStep("step", () => {
      events.push("step")
    })
  await action.run(1)
  expect(events).toEqual(["before", "after"])
  await action.runSafe("invalid" as never)
  expect(events).toEqual(["before", "after"])
  expect(() =>
    createAction().beforeRun(" ", () => {
      return undefined
    }),
  ).toThrow(TypeError)
})

test("hooked runs reject data collisions instead of violating captured hook types", async () => {
  const action = createAction()
    .beforeRun("start", () => {
      return { startTime: 1 }
    })
    .afterRun("read", ({ data }) => {
      data.startTime.toFixed()
    })
    .step("overwrite", () => {
      return { startTime: "wrong" }
    })
  expect((await action.runSafe()).error).toMatchObject({
    name: "StepError",
    cause: expect.any(TypeError),
  })
})

test("waits for pending work before reporting a distinct wrapper failure", async () => {
  for (const innerFails of [false, true]) {
    for (const safe of [false, true]) {
      const started = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const wrapperError = new Error("wrapper")
      let finished = false
      const action = createAction()
        .aroundRun("wrapper", ({ run }) => {
          void run()
          throw wrapperError
        })
        .step("pending", async () => {
          started.resolve(undefined)
          await release.promise
          finished = true
          if (innerFails) throw new Error("inner")
        })
      let settled = false
      const result = (
        safe
          ? action.runSafe().then((value) => value.error)
          : action.run().catch((error: unknown) => error)
      ).then((error) => {
        settled = true
        return error
      })
      await started.promise
      await Promise.resolve()
      expect(settled).toBe(false)
      release.resolve(undefined)
      expect(await result).toMatchObject({
        name: "HookError",
        hookName: "wrapper",
        cause: wrapperError,
      })
      expect(finished).toBe(true)
    }
  }
})

test("caught duplicate and late continuations never execute the body again", async () => {
  let executions = 0
  let captured: (() => Promise<void>) | undefined
  const action = createAction()
    .aroundRun("twice", async ({ run }) => {
      captured = run
      await run()
      try {
        await run()
      } catch {
        /* Deliberately catch the protocol error */
      }
    })
    .step("work", () => {
      executions++
    })
  expect((await action.runSafe()).error).toMatchObject({ name: "HookError" })
  expect(() => captured!()).toThrow("exactly once")
  expect(executions).toBe(1)
})

test("nested wrappers preserve normalized error identity and validate once", async () => {
  let validations = 0
  const seen: unknown[] = []
  const action = createAction()
    .errors({
      BAD: {
        data: z.string().transform((value) => {
          validations++
          return value.length
        }),
      },
    })
    .aroundRun("outer", async ({ run }) => {
      try {
        await run()
      } catch (error) {
        seen.push(error)
        throw error
      }
    })
    .aroundStep("inner", async ({ runStep }) => {
      try {
        await runStep()
      } catch (error) {
        seen.push(error)
        throw error
      }
    })
    .step("fail", ({ errors }) => {
      throw errors.BAD({ data: "bad" })
    })
  const operation = await action.runSafe()
  expect(validations).toBe(1)
  expect(operation.error).toMatchObject({ code: "BAD", data: 3 })
  expect(seen).toHaveLength(2)
  for (const error of seen) expect(error).toBe(operation.error)
})

test("around contexts expose fresh frozen data snapshots", async () => {
  let before: object | undefined
  let after: object | undefined
  await createAction()
    .aroundRun("observe", async (context) => {
      before = context.data
      await context.run()
      after = context.data
    })
    .step("work", () => {
      return { value: 42 }
    })
    .run()
  expect(before).toEqual({})
  expect(after).toEqual({ value: 42 })
  expect(before).not.toBe(after)
  expect(Object.isFrozen(before)).toBe(true)
  expect(Object.isFrozen(after)).toBe(true)
})

test("output setters expire and around hooks cannot use untyped setters", async () => {
  let setter: ((value: number) => void) | undefined
  const action = createAction()
    .output(z.number())
    .step("set", ({ setOutput }) => {
      setter = setOutput
      setOutput(1)
    })
  expect((await action.run()).output).toBe(1)
  expect(() => setter!(2)).toThrow("before the step or hook finishes")
  const invalid = createAction()
    .output(z.number())
    .aroundRun("invalid", async (context) => {
      await context.run()
      ;(context as unknown as { setOutput: (value: number) => void }).setOutput(2)
    })
    .step("set", ({ setOutput }) => {
      return setOutput(1)
    })
  expect((await invalid.runSafe()).error).toMatchObject({
    name: "HookError",
    cause: expect.objectContaining({ message: "Around hooks cannot set output" }),
  })
})
