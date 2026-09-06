import type {
  RecordDeletionExecuteInput,
  RecordDeletionPreview,
  RecordDeletionPreviewInput,
  RecordDeletionResult,
} from "@formal/modules/record-deletion/record-deletion-types";
import { withRequestDeadline } from "./request-deadline";

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
  return withRequestDeadline(signal => requestFormalRecordDeletion<RecordDeletionPreview>(
    "/api/formal/record-deletions/preview",
    input,
    fetcher,
    signal,
  ), 15_000, "删除关联检查超时，可以重新检查；尚未提交删除。");
}

export async function executeFormalRecordDeletion(
  input: RecordDeletionExecuteInput,
  fetcher: FetchLike = fetch,
): Promise<RecordDeletionResult> {
  const result = await withRequestDeadline(signal => requestFormalRecordDeletion<RecordDeletionResult>(
    "/api/formal/record-deletions/execute",
    input,
    fetcher,
    signal,
  ), 30_000, "删除结果尚未确认。请查询结果，或沿用原请求重试；超时不代表删除已经取消。");
  assertDeletionResult(result, input);
  return result;
}

export async function readFormalRecordDeletionResult(input: RecordDeletionExecuteInput, fetcher: FetchLike = fetch): Promise<RecordDeletionResult | null> {
  return withRequestDeadline(async signal => {
    const response = await fetcher(`/api/formal/record-deletions/result?requestId=${encodeURIComponent(input.requestId)}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { requestId?: unknown; status?: unknown; result?: unknown; error?: unknown } | null;
    signal.throwIfAborted();
    if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "删除结果查询失败，请稍后重新查询；原请求仍保留。");
    if (payload?.requestId !== input.requestId) throw new Error("删除回执不匹配，请重新查询；原请求仍保留。");
    if (payload.status === "unconfirmed" && payload.result === null) return null;
    if (payload.status !== "completed" || !payload.result || typeof payload.result !== "object") throw new Error("删除回执不完整，请重新查询；原请求仍保留。");
    const result = payload.result as RecordDeletionResult;
    assertDeletionResult(result, input);
    return result;
  }, 15_000, "删除结果查询超时，可以重新查询；查询不会重新执行删除，原请求仍保留。");
}

function assertDeletionResult(result: RecordDeletionResult, input: RecordDeletionExecuteInput): void {
  const deleted = Array.isArray(result.deletedRecords) ? result.deletedRecords.map(recordIdentity) : [];
  const expected = input.selectedRecords.map(recordIdentity).sort();
  if (result.requestId !== input.requestId
      || recordIdentity(result.root) !== recordIdentity(input.root)
      || deleted.some((identity) => identity === null)
      || JSON.stringify(deleted.sort()) !== JSON.stringify(expected)
      || !Number.isSafeInteger(result.fileCleanupPending) || result.fileCleanupPending < 0) {
    throw new FormalRecordDeletionApiError("无法确认删除结果，请沿用原请求重试，不要新建删除请求。", "DELETION_RESULT_UNCONFIRMED", input.requestId, 502);
  }
}

function recordIdentity(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { kind?: unknown; recordNo?: unknown };
  return typeof record.kind === "string" && typeof record.recordNo === "string" ? `${record.kind}:${record.recordNo}` : null;
}

async function requestFormalRecordDeletion<Result>(
  url: string,
  input: unknown,
  fetcher: FetchLike,
  signal: AbortSignal,
): Promise<Result> {
  const response = await fetcher(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const payload = await response.json().catch(() => null) as {
    error?: unknown;
    code?: unknown;
    requestId?: unknown;
  } | Result | null;
  signal.throwIfAborted();
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
