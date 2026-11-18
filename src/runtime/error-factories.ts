import { type ErrorMap, OperandiError } from "../errors"
import type { RuntimeFactories } from "./definition"

export function mergeErrors(current: ErrorMap, added: ErrorMap): ErrorMap {
  for (const code of Object.keys(added)) {
    if (Object.hasOwn(current, code)) throw new TypeError(`Duplicate error code: ${code}`)
  }
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(added).map(([code, definition]) => [code, { ...definition }]),
    ),
  }
}

export function createErrorFactories(definitions: ErrorMap): RuntimeFactories {
  return Object.fromEntries(
    Object.entries(definitions).map(([code, definition]) => [
      code,
      (options: { data?: unknown; message?: string; cause?: unknown } = {}) =>
        new OperandiError(code, options.data, {
          message: options.message ?? definition.message ?? code,
          cause: options.cause,
        }),
    ]),
  )
}
