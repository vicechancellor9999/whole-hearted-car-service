import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { MasterDataService } from "@formal/modules/master-data/master-data-service";

export function createMasterDataRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new MasterDataService(
      createPostgresAuthSqlDatabase(databaseClient.sql),
    ),
    close: databaseClient.close,
  };
}
