import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createRecordDeletionRuntime } from "@formal/modules/record-deletion/record-deletion-runtime";
import { parseDeletionRequestId, type RecordDeletionResult } from "@formal/modules/record-deletion/record-deletion-types";
import { recordDeletionApiError } from "@formal/app/api/record-deletions/api-response";

export function createRecordDeletionResultApiHandler(dependencies: {
  readSession(): Promise<{ account: { id: number } } | null>;
  readResult(input: { requestId: string; actorAccountId: number }): Promise<RecordDeletionResult | null>;
}) {
  return async (request: Request): Promise<Response> => {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "请先登录", code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    let requestId: string | undefined;
    try {
      requestId = parseDeletionRequestId(new URL(request.url).searchParams.get("requestId"));
      const result = await dependencies.readResult({ requestId, actorAccountId: session.account.id });
      return NextResponse.json({ requestId, status: result ? "completed" : "unconfirmed", result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const response = recordDeletionApiError(error, requestId);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  const runtime = createRecordDeletionRuntime(process.env);
  try {
    return await createRecordDeletionResultApiHandler({ readSession: currentSession, readResult: input => runtime.service.readResult(input) })(request);
  } finally {
    await runtime.close();
  }
}
