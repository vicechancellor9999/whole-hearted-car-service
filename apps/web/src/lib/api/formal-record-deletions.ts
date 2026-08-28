import type {
  RecordDeletionExecuteInput,
  RecordDeletionPreview,
  RecordDeletionPreviewInput,
  RecordDeletionResult,
} from "@formal/modules/record-deletion/record-deletion-types";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class FormalRecordDeletionApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId: string | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FormalRecordDeletionApiError";
  }
}

export async function previewFormalRecordDeletion(
  input: RecordDeletionPreviewInput,
  fetcher: FetchLike = fetch,
): Promise<RecordDeletionPreview> {
  return requestFormalRecordDeletion<RecordDeletionPreview>(
    "/api/formal/record-deletions/preview",
    input,
    fetcher,
  );
}

export async function executeFormalRecordDeletion(
  input: RecordDeletionExecuteInput,
  fetcher: FetchLike = fetch,
): Promise<RecordDeletionResult> {
  return requestFormalRecordDeletion<RecordDeletionResult>(
    "/api/formal/record-deletions/execute",
    input,
    fetcher,
  );
}

async function requestFormalRecordDeletion<Result>(
  url: string,
  input: unknown,
  fetcher: FetchLike,
): Promise<Result> {
  const response = await fetcher(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as {
    error?: unknown;
    code?: unknown;
    requestId?: unknown;
  } | Result | null;
  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object"
      ? payload as { error?: unknown; code?: unknown; requestId?: unknown }
      : {};
    throw new FormalRecordDeletionApiError(
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : "删除操作未完成，请稍后重试",
      typeof errorPayload.code === "string"
        ? errorPayload.code
        : "RECORD_DELETE_FAILED",
      typeof errorPayload.requestId === "string" ? errorPayload.requestId : null,
      response.status,
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new FormalRecordDeletionApiError(
      "删除接口返回资料不完整",
      "RECORD_DELETE_FAILED",
      null,
      502,
    );
  }
  return payload as Result;
}
