import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { BusinessOrderService } from "@/modules/business-order/business-order-service";

export function createBusinessOrderRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new BusinessOrderService(
      createPostgresAuthSqlDatabase(databaseClient.sql),
    ),
    close: databaseClient.close,
  };
}
