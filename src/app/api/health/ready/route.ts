import { sql } from "drizzle-orm";
import { createDatabaseClient } from "@/db/client";

export function createReadinessHandler(checkDatabase: () => Promise<void>) {
  return async function readinessHandler(): Promise<Response> {
    try {
      await checkDatabase();
      return Response.json({ status: "ready" });
    } catch {
      return Response.json({ status: "not_ready" }, { status: 503 });
    }
  };
}

async function checkDatabaseConnection(): Promise<void> {
  const client = createDatabaseClient();

  try {
    await client.db.execute(sql`select 1`);
  } finally {
    await client.close();
  }
}

export const GET = createReadinessHandler(checkDatabaseConnection);
