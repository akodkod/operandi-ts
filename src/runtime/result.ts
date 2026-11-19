import type { OperationResult } from "../types"

export const operationResultBrand = Symbol.for("operandi.OperationResult.v1")

export function createOperationResult<Input, Output>(
  input: Input,
  output: Output,
): OperationResult<Input, Output> {
  return Object.defineProperty(
    { input, output, [operationResultBrand]: true as const },
    operationResultBrand,
    {
      enumerable: false,
    },
  )
}

export function isOperationResult(value: unknown): value is OperationResult<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    operationResultBrand in value &&
    value[operationResultBrand] === true
  )
}
