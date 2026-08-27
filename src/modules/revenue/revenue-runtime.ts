import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { RevenueService } from "@formal/modules/revenue/revenue-service";

export function createRevenueRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new RevenueService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
