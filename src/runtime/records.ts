export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}

export function combine(previous: unknown, next: unknown): unknown {
  if (previous === undefined) return next
  if (next === undefined) return previous

  if (!isRecord(previous) || !isRecord(next)) {
    throw new TypeError("Middleware input and output must be plain objects")
  }

  return { ...previous, ...next }
}
