import { createAction, createActionMiddleware } from "../src/index"
import { expect, test } from "bun:test"
import { z } from "zod"
import { AsyncLocalStorage } from "node:async_hooks"

for (const failure of [
  undefined,
  "access",
  "before",
  "step",
  "after",
  "output",
  "wrapper",
] as const) {
  test(`transaction middleware ${failure ? `rolls back on ${failure}` : "commits after the full action"}`, async () => {
    const context = new AsyncLocalStorage<{ active: boolean }>()
    const events: string[] = []
    let caught: unknown

    const withTransaction = createActionMiddleware("With Transaction")
      .aroundRun("transaction", async ({ run, actionName, middlewareName }) => {
        expect(actionName).toBe("Save")
        expect(middlewareName).toBe("With Transaction")
        const tx = { active: true }

        await context.run(tx, async () => {
          events.push("begin")

          try {
            await run()
            events.push("commit")
          } catch (error) {
            caught = error
            events.push("rollback")
            throw error
          } finally {
            tx.active = false
          }
        })
      })
      .beforeRun("transaction data", () => {
        return { tx: context.getStore()! }
      })

    function check(phase: string) {
      expect(context.getStore()?.active).toBe(true)
      events.push(phase)
      if (failure === phase && phase !== "output") throw new Error(phase)
    }

    const access = createActionMiddleware("Access").step("access", () => {
      check("access")
    })

    const action = createAction("Save")
      .use(withTransaction)
      .use(access)
      .output(
        z.object({ saved: z.boolean() }).refine(() => {
          check("output")
          return failure !== "output"
        }),
      )
      .aroundRun("action wrapper", async ({ run }) => {
        await run()
        check("wrapper")
      })
      .beforeRun("before", () => {
        check("before")
      })
      .afterRun("after", () => {
        check("after")
      })
      .step("save", async ({ data, setOutput }) => {
        await Promise.resolve()
        expect(data.tx).toBe(context.getStore()!)
        check("step")
        setOutput({ saved: true })
      })

    const result = await action.runSafe()

    if (failure) {
      expect(caught).toBe(result.error)
      expect(result.error).toBeDefined()
      expect(events.at(-1)).toBe("rollback")
      expect(events).not.toContain("commit")
    } else {
      expect(result.output).toEqual({ saved: true })

      expect(events).toEqual([
        "begin",
        "before",
        "access",
        "step",
        "after",
        "output",
        "wrapper",
        "commit",
      ])
    }

    expect(context.getStore()).toBeUndefined()
  })
}

test("nested middleware wrappers enclose siblings and action hooks in registration order", async () => {
  const events: string[] = []

  function wrapper(name: string) {
    return createActionMiddleware(name).aroundRun(name, async ({ run }) => {
      events.push(`${name} enter`)
      await run()
      events.push(`${name} exit`)
    })
  }

  const parent = wrapper("parent").use(wrapper("nested"))

  await createAction()
    .use(parent)
    .use(wrapper("sibling"))
    .aroundRun("action", async ({ run }) => {
      events.push("action enter")
      await run()
      events.push("action exit")
    })
    .step("work", () => {
      events.push("work")
    })
    .run()

  expect(events).toEqual([
    "nested enter",
    "parent enter",
    "sibling enter",
    "action enter",
    "work",
    "action exit",
    "sibling exit",
    "parent exit",
    "nested exit",
  ])
})

test("transaction middleware keeps concurrent and standalone runs isolated", async () => {
  const context = new AsyncLocalStorage<number>()

  const middleware = createActionMiddleware()
    .input(z.object({ id: z.number() }))
    .beforeRun("data", ({ input }) => {
      return { id: input.id }
    })
    .aroundRun("context", async (hook) => {
      expect(hook.data.id).toBeUndefined()
      await context.run(hook.input.id, hook.run)
      expect(hook.data.id).toBe(hook.input.id)
    })

  const action = createAction()
    .use(middleware)
    .step("check context", async ({ data }) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(context.getStore()).toBe(data.id)
    })

  await Promise.all([action.run({ id: 1 }), action.run({ id: 2 }), middleware.run({ id: 3 })])
})

test("invalid input never opens a middleware transaction", async () => {
  let opened = false

  const middleware = createActionMiddleware().aroundRun("transaction", async ({ run }) => {
    opened = true
    await run()
  })

  await createAction()
    .use(middleware)
    .input(z.object({ id: z.number() }))
    .runSafe({ id: "bad" } as never)

  expect(opened).toBe(false)
})
