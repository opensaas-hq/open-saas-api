/**
 * The Swagger UI page (§4.10).
 *
 * The page is served by the API itself and loads the Swagger UI bundle from
 * the jsDelivr CDN, the same way the `@hono/zod-openapi` documentation does.
 * The contract it renders is always the live one: `/api/v1/openapi.json` is
 * generated from the running application, never from a static copy.
 */

/** The version of the Swagger UI bundle the page loads. */
const SWAGGER_UI_VERSION = "5.17.14";

/**
 * The Content-Security-Policy of the documentation page.
 *
 * The default policy of the API (`default-src 'self'`) would block the CDN
 * that serves the Swagger UI bundle, so the documentation route relaxes it:
 * scripts and styles may come from the CDN, everything else stays on the
 * instance itself.
 */
export const swaggerUiContentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' https://cdn.jsdelivr.net`,
  `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`,
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
].join("; ");

/**
 * Build the HTML of the Swagger UI page.
 *
 * @param specUrl The URL of the OpenAPI document the page renders.
 */
export const swaggerUiHtml = (specUrl: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open SaaS API — reference</title>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"
    />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl)},
          dom_id: "#swagger-ui",
          deepLinking: true,
          persistAuthorization: true,
        });
      };
    </script>
  </body>
</html>
`;
