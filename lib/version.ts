/**
 * The build's version string.
 *
 * A literal rather than a `package.json` read: the single executable has no
 * `package.json` next to it, and it doubles as the key for the native-addon
 * extraction cache. `test/version.test.ts` asserts it still matches
 * `package.json`, so the two cannot drift.
 *
 * @module
 */
export const VERSION = "0.11.1";
