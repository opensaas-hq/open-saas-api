import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is missing");
}

// Initialize postgres client for queries
const queryClient = postgres(connectionString);

// Export typed Drizzle database instance
export const db = drizzle(queryClient, { schema });
