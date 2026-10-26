import { z } from "zod";

/**
 * Maximum nesting depth of a contact metadata payload. A flat object has
 * depth 1; each nested object or array adds one level.
 */
export const METADATA_MAX_DEPTH = 3;

/**
 * Maximum serialized size, in bytes, of a contact metadata payload.
 */
export const METADATA_MAX_BYTES = 8_192;

/**
 * Nesting depth of a JSON-like value. Scalars have depth 0, an object or array
 * has one level more than its deepest child.
 */
const depthOf = (value: unknown): number => {
  if (Array.isArray(value)) {
    return (
      value.reduce((deepest, item) => Math.max(deepest, depthOf(item)), 0) + 1
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      Object.values(value).reduce(
        (deepest, item) => Math.max(deepest, depthOf(item)),
        0,
      ) + 1
    );
  }

  return 0;
};

/**
 * Size, in bytes, of the serialized payload.
 */
const sizeOf = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").length;

/**
 * Schema of the free-form `metadata` payload of a contact.
 *
 * The payload is unbounded by nature, so it is capped in two ways: a maximum
 * nesting depth ({@link METADATA_MAX_DEPTH}) and a maximum serialized size
 * ({@link METADATA_MAX_BYTES}). Both are enforced here, so a payload that
 * exceeds them is refused with a 422 instead of being stored.
 */
export const metadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    const depth = depthOf(value);

    if (depth > METADATA_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `metadata must not be nested deeper than ${METADATA_MAX_DEPTH} levels`,
        // The path is relative to the metadata payload: the parent object adds
        // the `metadata` field name.
        path: [],
      });
    }

    const size = sizeOf(value);

    if (size > METADATA_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `metadata must not exceed ${METADATA_MAX_BYTES} bytes`,
        path: [],
      });
    }
  });
