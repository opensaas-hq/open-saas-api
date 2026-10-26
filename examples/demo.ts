#!/usr/bin/env bun
const API_URL = process.env.API_URL || "http://localhost:3000";

async function main() {
  console.log("OpenSaaS API Demo");
  console.log("1. Health check");
  const health = await fetch(`${API_URL}/healthz`).then((r) => r.json());
  console.log(health);

  console.log("\n2. OpenAPI docs available at:", `${API_URL}/api/v1/docs`);
  console.log("3. GraphQL endpoint at:", `${API_URL}/graphql`);
}

main().catch(console.error);
