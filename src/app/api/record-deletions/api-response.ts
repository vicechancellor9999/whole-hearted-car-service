import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { RecordDeletionError } from "@formal/modules/record-deletion/record-deletion-errors";

export function recordDeletionApiError(
  error: unknown,
  requestId?: string,
): NextResponse {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: error instanceof ZodError
          ? error.issues[0]?.message ?? "删除资料格式不正确"
          : "删除资料格式不正确",
        code: "INVALID_DELETION_REQUEST",
        ...(requestId ? { requestId } : {}),
      },
      { status: 400 },
    );
  }
  if (error instanceof RecordDeletionError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(requestId ? { requestId } : {}),
      },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      error: "删除操作未完成，请稍后重试",
      code: "RECORD_DELETE_FAILED",
      ...(requestId ? { requestId } : {}),
    },
    { status: 500 },
  );
}
