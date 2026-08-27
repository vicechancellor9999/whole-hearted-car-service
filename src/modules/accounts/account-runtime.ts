import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { AccountService } from "@formal/modules/accounts/account-service";

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
