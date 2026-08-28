import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createRecordDeletionRuntime } from "@formal/modules/record-deletion/record-deletion-runtime";
import { parseDeletionPreviewInput } from "@formal/modules/record-deletion/record-deletion-types";
import type { PreviewDeletionInput } from "@formal/modules/record-deletion/record-deletion-service";
import { recordDeletionApiError } from "@formal/app/api/record-deletions/api-response";

type RecordDeletionApiSession = { account: { id: number } };

type PreviewApiDependencies = {
  readSession(): Promise<RecordDeletionApiSession | null>;
  preview(input: PreviewDeletionInput): Promise<unknown>;
};

export function createRecordDeletionPreviewApiHandler(
  dependencies: PreviewApiDependencies,
) {
  return async function recordDeletionPreviewApiHandler(
    request: Request,
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) {
      return NextResponse.json(
        { error: "请先登录", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    try {
      const input = parseDeletionPreviewInput(await request.json());
      const result = await dependencies.preview({
        ...input,
        actorAccountId: session.account.id,
      });
      return NextResponse.json(result);
    } catch (error) {
      return recordDeletionApiError(error);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createRecordDeletionRuntime(process.env);
  try {
    return await createRecordDeletionPreviewApiHandler({
      readSession: currentSession,
      preview: (input) => runtime.service.preview(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
