import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { DashboardService } from "@formal/modules/dashboard/dashboard-service";

export function createDashboardRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new DashboardService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
