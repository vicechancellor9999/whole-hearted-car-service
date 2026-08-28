export type RecordDeletionErrorCode =
  | "RECORD_DELETE_DENIED"
  | "RECORD_NOT_FOUND"
  | "RECORD_DELETE_BLOCKED"
  | "DELETION_PREVIEW_STALE"
  | "DELETION_REQUEST_CONFLICT"
  | "RECORD_DELETE_FAILED";

export class RecordDeletionError extends Error {
  constructor(
    public readonly code: RecordDeletionErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RecordDeletionError";
  }
}

export function recordDeleteDenied(): RecordDeletionError {
  return new RecordDeletionError(
    "RECORD_DELETE_DENIED",
    403,
    "当前账号没有删除记录的权限",
  );
}

export function recordNotFound(): RecordDeletionError {
  return new RecordDeletionError(
    "RECORD_NOT_FOUND",
    404,
    "记录不存在或已经删除",
  );
}

export function deletionPreviewStale(): RecordDeletionError {
  return new RecordDeletionError(
    "DELETION_PREVIEW_STALE",
    409,
    "删除范围已经变化，请重新检查后确认",
  );
}

export function deletionRequestConflict(): RecordDeletionError {
  return new RecordDeletionError(
    "DELETION_REQUEST_CONFLICT",
    409,
    "删除请求编号已用于另一项操作",
  );
}

export function recordDeleteBlocked(): RecordDeletionError {
  return new RecordDeletionError(
    "RECORD_DELETE_BLOCKED",
    409,
    "当前记录无法删除",
  );
}
