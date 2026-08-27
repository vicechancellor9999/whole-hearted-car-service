import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { PaymentWorkspaceService } from "@formal/modules/payment/payment-workspace-service";

export function createPaymentWorkspaceRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new PaymentWorkspaceService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
