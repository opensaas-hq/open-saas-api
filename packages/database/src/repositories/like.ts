/**
 * Escape the wildcard and escape characters in a `LIKE`/`ILIKE` pattern so user
 * input is matched literally instead of as a pattern. Without this, a search
 * for `100%` or `_` would match unintended rows (or scan the whole table).
 *
 * The escape character is the backslash, matching the `ESCAPE '\'` clause the
 * repositories append to every pattern built from user input.
 */
export const escapeLikePattern = (input: string): string =>
  input.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Build a contains-match pattern for user input: escape it, then wrap it in
 * `%…%`. Always pair this with an `ESCAPE '\'` clause at the call site.
 */
export const toContainsLikePattern = (input: string): string =>
  `%${escapeLikePattern(input)}%`;
