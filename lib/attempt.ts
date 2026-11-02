/**
 * Runs `fn` and hands back its result as a promise, turning a synchronous
 * throw into a rejection — `Promise.try` (ES2025), which Node has but the
 * ES2022 TypeScript lib this repo type-checks against does not declare.
 * The device adapters need exactly this: callers like the cursor loop chain
 * `.catch()` without awaiting, so a native call that throws must reject,
 * never escape synchronously.
 */
export function attempt<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve) => resolve(fn()));
}
