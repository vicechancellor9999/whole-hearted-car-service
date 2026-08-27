import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { PaymentWorkspaceService } from "@/modules/payment/payment-workspace-service";

export function createPaymentWorkspaceRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return {
    service: new PaymentWorkspaceService(createPostgresAuthSqlDatabase(client.sql)),
    close: client.close,
  };
}
