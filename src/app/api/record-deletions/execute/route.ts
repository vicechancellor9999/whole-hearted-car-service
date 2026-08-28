import { after, NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createRecordDeletionRuntime } from "@formal/modules/record-deletion/record-deletion-runtime";
import { parseDeletionExecuteInput, type RecordDeletionExecuteInput, type RecordDeletionResult } from "@formal/modules/record-deletion/record-deletion-types";
import type { RecordDeletionActionContext } from "@formal/modules/record-deletion/record-deletion-service";
import { recordDeletionApiError } from "@formal/app/api/record-deletions/api-response";

type RecordDeletionApiSession = { account: { id: number } };
type ExecuteInput = RecordDeletionExecuteInput & RecordDeletionActionContext;

type ExecuteApiDependencies = {
  readSession(): Promise<RecordDeletionApiSession | null>;
  execute(input: ExecuteInput): Promise<RecordDeletionResult>;
};

export function createRecordDeletionExecuteApiHandler(
  dependencies: ExecuteApiDependencies,
) {
  return async function recordDeletionExecuteApiHandler(
    request: Request,
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) {
      return NextResponse.json(
        { error: "请先登录", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    let requestId: string | undefined;
    try {
      const input = parseDeletionExecuteInput(await request.json());
      requestId = input.requestId;
      const result = await dependencies.execute({
        ...input,
        actorAccountId: session.account.id,
        ipAddress: forwardedAddress(request),
        userAgent: request.headers.get("user-agent"),
      });
      return NextResponse.json(result);
    } catch (error) {
      return recordDeletionApiError(error, requestId);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createRecordDeletionRuntime(process.env);
  let deferred = false;
  try {
    const response = await createRecordDeletionExecuteApiHandler({
      readSession: currentSession,
      execute: (input) => runtime.service.execute(input),
    })(request);
    if (response.ok) {
      deferred = true;
      after(async () => {
        try {
          await runtime.processFileTasks();
        } finally {
          await runtime.close();
        }
      });
    }
    return response;
  } finally {
    if (!deferred) await runtime.close();
  }
}

function forwardedAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
}
