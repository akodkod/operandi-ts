import { ValidationError } from "../errors"
import type { Definition, Prepared, Schema } from "./definition"
import { combine } from "./records"

export async function validate(
  schema: Schema,
  value: unknown,
  phase: "input" | "output" | "error",
): Promise<unknown> {
  const result = await schema["~standard"].validate(value)
  if (result.issues) throw new ValidationError(phase, result.issues)
  return result.value
}

export async function prepare(definition: Definition, rawInput: unknown): Promise<Prepared> {
  const middleware: Prepared[] = []
  let input: unknown
  for (const child of definition.middleware) {
    const prepared = await prepare(child, rawInput)
    middleware.push(prepared)
    input = combine(input, prepared.input)
  }
  if (definition.inputSchema)
    input = combine(input, await validate(definition.inputSchema, rawInput, "input"))
  return { definition, input, middleware }
}
