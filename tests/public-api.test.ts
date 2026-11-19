import * as api from "../src/index"
import { expect, test } from "bun:test"

test("preserves the public runtime exports", () => {
  expect(Object.keys(api).sort()).toEqual(
    [
      "HookError",
      "OperandiError",
      "StepError",
      "UnexpectedError",
      "ValidationError",
      "createAction",
      "createActionMiddleware",
      "isOperationResult",
    ].sort(),
  )
})
