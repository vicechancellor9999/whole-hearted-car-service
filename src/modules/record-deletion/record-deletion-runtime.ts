import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { RecordDeletionService } from "@formal/modules/record-deletion/record-deletion-service";
import { processRecordDeletionFileTasks } from "@formal/modules/record-deletion/record-deletion-file-cleanup";

export function createRecordDeletionRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  const database = createPostgresAuthSqlDatabase(databaseClient.sql);
  return {
    service: new RecordDeletionService(database),
    processFileTasks: () => processRecordDeletionFileTasks(database),
    close: databaseClient.close,
  };
}
