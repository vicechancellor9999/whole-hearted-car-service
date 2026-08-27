import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { PerformanceService } from "@formal/modules/performance/performance-service";

export function createPerformanceRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  const database = createPostgresAuthSqlDatabase(databaseClient.sql);
  return {
    service: new PerformanceService(database),
    close: databaseClient.close,
  };
}
