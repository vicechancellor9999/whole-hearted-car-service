import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { AuditService } from "@formal/modules/audit/audit-service";

export function createAuditRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new AuditService(
      createPostgresAuthSqlDatabase(databaseClient.sql),
    ),
    close: databaseClient.close,
  };
}
