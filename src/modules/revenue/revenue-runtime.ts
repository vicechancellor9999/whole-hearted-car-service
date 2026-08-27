import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { RevenueService } from "@/modules/revenue/revenue-service";

export function createRevenueRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new RevenueService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
