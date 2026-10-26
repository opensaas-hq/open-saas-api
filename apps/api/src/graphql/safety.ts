import {
  type DocumentNode,
  type FragmentDefinitionNode,
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  type OperationDefinitionNode,
  type SelectionSetNode,
  validate,
} from "graphql";
import type { Plugin } from "graphql-yoga";

/** Limits a document must respect before it reaches the executor (§4.11). */
export type QueryLimits = {
  /** Maximum nesting of selection sets. */
  maxDepth: number;
  /** Maximum number of selected fields, fragments expanded. */
  maxCost: number;
};

/** What a document costs: its depth and its field count. */
export type QueryMeasure = {
  depth: number;
  cost: number;
};

const isFragmentDefinition = (
  node: DocumentNode["definitions"][number],
): node is FragmentDefinitionNode => node.kind === Kind.FRAGMENT_DEFINITION;

const isOperationDefinition = (
  node: DocumentNode["definitions"][number],
): node is OperationDefinitionNode => node.kind === Kind.OPERATION_DEFINITION;

const fragmentMap = (
  document: DocumentNode,
): Map<string, FragmentDefinitionNode> =>
  new Map(
    document.definitions
      .filter(isFragmentDefinition)
      .map((fragment) => [fragment.name.value, fragment]),
  );

/**
 * Measure a selection set.
 *
 * Every field costs one; its sub-selection adds to that cost. An inline
 * fragment adds its own cost without adding depth, and a fragment spread is
 * expanded once per usage (a cycle cannot be measured and is left to the
 * standard validation rules, which reject it). The variables are not counted:
 * the measure describes the shape of the document, not the size of the values.
 */
const measureSelectionSet = (
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visiting: ReadonlySet<string>,
): QueryMeasure => {
  let depth = 0;
  let cost = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const child = selection.selectionSet
        ? measureSelectionSet(selection.selectionSet, fragments, visiting)
        : { depth: 0, cost: 0 };

      depth = Math.max(depth, child.depth + 1);
      cost += child.cost + 1;
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const child = measureSelectionSet(
        selection.selectionSet,
        fragments,
        visiting,
      );

      depth = Math.max(depth, child.depth);
      cost += child.cost;
      continue;
    }

    const name = selection.name.value;
    const fragment = fragments.get(name);

    if (!fragment || visiting.has(name)) continue;

    const child = measureSelectionSet(
      fragment.selectionSet,
      fragments,
      new Set(visiting).add(name),
    );

    depth = Math.max(depth, child.depth);
    cost += child.cost;
  }

  return { depth, cost };
};

/**
 * Measure every operation of a document.
 *
 * The reported depth and cost are the maximum and the sum across operations:
 * a batched request is measured as a whole, never operation by operation.
 */
export const measureQuery = (document: DocumentNode): QueryMeasure => {
  const fragments = fragmentMap(document);
  let depth = 0;
  let cost = 0;

  for (const definition of document.definitions) {
    if (!isOperationDefinition(definition)) continue;

    const measured = measureSelectionSet(
      definition.selectionSet,
      fragments,
      new Set(),
    );

    depth = Math.max(depth, measured.depth);
    cost += measured.cost;
  }

  return { depth, cost };
};

/**
 * True for an operation that reads the schema itself.
 *
 * Introspection is a single, deep meta-query; it is gated by its own flag
 * (§4.11) instead of the depth and cost limits, so the limits can stay low
 * for the product queries.
 */
export const isIntrospectionDocument = (document: DocumentNode): boolean =>
  document.definitions.some(
    (definition) =>
      isOperationDefinition(definition) &&
      definition.selectionSet.selections.some(
        (selection) =>
          selection.kind === Kind.FIELD &&
          (selection.name.value === "__schema" ||
            selection.name.value === "__type"),
      ),
  );

/**
 * Refuse a document that exceeds the limits with a typed error.
 *
 * The error carries the measured value and the configured limit, so a client
 * can tell what to trim without guessing.
 */
export const assertQueryWithinLimits = (
  document: DocumentNode,
  limits: QueryLimits,
): void => {
  if (isIntrospectionDocument(document)) return;

  const { depth, cost } = measureQuery(document);

  if (depth > limits.maxDepth) {
    throw new GraphQLError(
      `The query is deeper than the maximum depth of ${limits.maxDepth}`,
      {
        extensions: {
          code: "QUERY_TOO_DEEP",
          depth,
          maxDepth: limits.maxDepth,
        },
      },
    );
  }

  if (cost > limits.maxCost) {
    throw new GraphQLError(
      `The query costs more than the maximum complexity of ${limits.maxCost}`,
      {
        extensions: {
          code: "QUERY_TOO_COMPLEX",
          cost,
          maxCost: limits.maxCost,
        },
      },
    );
  }
};

/** Options of {@link createQuerySafetyPlugin}. */
export type QuerySafetyOptions = QueryLimits & {
  /** Whether the schema may be read through `__schema` / `__type`. */
  introspection: boolean;
};

/**
 * Build the plugin that enforces the limits before execution (§4.11).
 *
 * The document is measured between parsing and validation: a rejected
 * document never reaches a resolver. The errors are answered with the
 * standard GraphQL `errors` body, exactly like a validation failure.
 */
export const createQuerySafetyPlugin = (
  options: QuerySafetyOptions,
): Plugin => ({
  onValidate({ setValidationFn }) {
    setValidationFn((schema, document, rules) => {
      const effectiveRules = options.introspection
        ? rules
        : [...rules, NoSchemaIntrospectionCustomRule];

      const errors = validate(schema, document, effectiveRules);

      if (errors.length > 0) return errors;

      try {
        assertQueryWithinLimits(document, options);
      } catch (error) {
        return [error as GraphQLError];
      }

      return errors;
    });
  },
});
