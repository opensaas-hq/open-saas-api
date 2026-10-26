import { AppError, type Logger } from "@opensaas/core";
import { GraphQLError } from "graphql";

/**
 * Map a thrown value to the GraphQL error contract (§4.11).
 *
 * The application errors keep their stable `code` and their HTTP class in the
 * `extensions`, so a client reads the same identifier whether it called REST
 * or GraphQL. An unknown error is reported as an internal error without its
 * message or details: internals never leak through either surface.
 */
export const toGraphQLError = (error: unknown): GraphQLError => {
  if (error instanceof GraphQLError) return error;

  if (error instanceof AppError) {
    return new GraphQLError(error.message, {
      originalError: error,
      extensions: {
        code: error.code,
        statusCode: error.statusCode,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  return new GraphQLError("An unexpected error occurred", {
    originalError: error instanceof Error ? error : undefined,
    extensions: { code: "INTERNAL_SERVER_ERROR", statusCode: 500 },
  });
};

/**
 * Run a resolver body and map whatever it throws to the error contract.
 *
 * Every resolver goes through this wrapper, so the mapping lives in one place
 * and an unexpected error is logged before it is masked.
 */
export const run = async <T>(
  logger: Logger,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof GraphQLError)) {
      logger.error(error, "Unhandled GraphQL resolver error");
    }

    throw toGraphQLError(error);
  }
};
