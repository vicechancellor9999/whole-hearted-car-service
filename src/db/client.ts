import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { parseAppEnv } from "@/lib/env";

export function createDatabaseClient(source: Record<string, unknown> = process.env) {
  const env = parseAppEnv(source);
  const queryClient = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return {
    db: drizzle(queryClient, { schema }),
    sql: queryClient,
    close: () => queryClient.end(),
  };
}
