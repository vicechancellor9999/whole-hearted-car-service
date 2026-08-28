import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";
import { removeStoredVehicleUpload } from "@formal/modules/customer-vehicle/attachment-storage";
import { removeStoredCustomerDriverLicenseUpload } from "@formal/modules/customer-vehicle/customer-driver-license-storage";
import { removeStoredRefundUpload } from "@formal/modules/payment/refund-attachment-storage";
import { removeStoredBusinessOrderUpload } from "@formal/modules/business-order/business-order-attachment-storage";

export type RecordDeletionFileCleanupOptions = {
  limit?: number;
  remove?: (storageKey: string) => Promise<void>;
};

type FileTaskRow = { id: number; storage_key: string };

export async function processRecordDeletionFileTasks(
  database: AuthSqlDatabase,
  options: RecordDeletionFileCleanupOptions = {},
): Promise<{ completed: number; failed: number }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const tasks = await database.query<FileTaskRow>(
    `select id, storage_key
     from record_deletion_file_tasks
     where state in ('pending', 'failed')
     order by created_at, id
     limit $1`,
    [limit],
  );
  const remove = options.remove ?? removeStoredDeletionFile;
  let completed = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await remove(task.storage_key);
      await database.query(
        `update record_deletion_file_tasks
         set state = 'completed', attempt_count = attempt_count + 1,
             last_error_code = null, completed_at = now()
         where id = $1 and state in ('pending', 'failed')`,
        [Number(task.id)],
      );
      completed += 1;
    } catch {
      await database.query(
        `update record_deletion_file_tasks
         set state = 'failed', attempt_count = attempt_count + 1,
             last_error_code = 'FILE_REMOVE_FAILED', completed_at = null
         where id = $1 and state in ('pending', 'failed')`,
        [Number(task.id)],
      );
      failed += 1;
    }
  }

  return { completed, failed };
}

async function removeStoredDeletionFile(storageKey: string): Promise<void> {
  if (storageKey.startsWith("customer-license-files/")) {
    await removeStoredCustomerDriverLicenseUpload(storageKey);
    return;
  }
  if (storageKey.startsWith("vehicle-files/") || storageKey.startsWith("vehicle/")) {
    await removeStoredVehicleUpload(storageKey);
    return;
  }
  if (storageKey.startsWith("refund-files/")) {
    await removeStoredRefundUpload(storageKey);
    return;
  }
  if (storageKey.startsWith("business-order-files/")) {
    await removeStoredBusinessOrderUpload(storageKey);
    return;
  }
  throw new Error("unsupported record deletion storage key");
}
