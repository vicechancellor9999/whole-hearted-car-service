import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { DashboardService } from "@/modules/dashboard/dashboard-service";

export function createDashboardRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new DashboardService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
