import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is missing");
}

// Initialize postgres client for queries
export const client = postgres(connectionString);

// Export typed Drizzle database instance with schema
export const db = drizzle(client, { schema });

export type Database = typeof db;

// Helper para transacciones reutilizables
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}
