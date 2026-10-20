/**
 * Re-export of the isolation lifecycle. Suites that write must *call*
 * `useTestDatabase()` in their own module body — importing a module that calls
 * it once would register hooks only for the first file (the module is cached).
 */
export { useTestDatabase } from "./guard";
