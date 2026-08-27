import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { PaymentService } from "@formal/modules/payment/payment-service";

export function createPaymentRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new PaymentService(createPostgresAuthSqlDatabase(databaseClient.sql)),
    close: databaseClient.close,
  };
}
