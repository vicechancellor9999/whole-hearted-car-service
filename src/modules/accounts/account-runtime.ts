import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { AccountService } from "@/modules/accounts/account-service";

export function createAccountRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new AccountService(
      createPostgresAuthSqlDatabase(databaseClient.sql),
    ),
    close: databaseClient.close,
  };
}
