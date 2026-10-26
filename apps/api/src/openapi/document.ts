import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../types";

/**
 * The OpenAPI 3.1 contract of the product surface (§4.10).
 *
 * The document is generated from the very same Zod schemas the runtime
 * validates and serializes, so the published contract cannot describe
 * something the API does not do.
 */
export const openApiDocumentConfig = {
  openapi: "3.1.0",
  info: {
    title: "Open SaaS API",
    version: "1.0.0",
    description: [
      "The versioned contract of the Open SaaS API.",
      "",
      "Every product route lives under `/api/v1`. The unprefixed paths are",
      "deprecated aliases: they keep working, they answer with the",
      "`Deprecation` and `Sunset` headers, and they will be removed after the",
      "sunset date.",
      "",
      "Every response uses the same envelope: `{ success: true, data }` on",
      "success and `{ success: false, error }` on failure.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "This instance" }],
  tags: [
    { name: "Contacts", description: "The contacts of a tenant" },
    { name: "Branches", description: "The branches of a tenant" },
    { name: "Registration", description: "The project-owned registration" },
  ],
};

/**
 * Build the OpenAPI 3.1 document of an application.
 *
 * The application must already carry the routes: the document is generated
 * from the registry the routers filled when they were mounted.
 */
export const buildOpenApiDocument = (
  app: OpenAPIHono<AppEnv>,
): Record<string, unknown> =>
  app.getOpenAPI31Document(openApiDocumentConfig) as unknown as Record<
    string,
    unknown
  >;
