import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { storedBusinessOrderUploadPath } from "@formal/modules/business-order/business-order-attachment-storage";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string; attachmentId: string }> };
type AttachmentFile = { storageKey: string; originalName: string; mediaType: string; sizeBytes: number };
type AttachmentFileApiDependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  getAttachmentFile(input: { businessOrderId: number; attachmentId: number; viewerAccountId: number }): Promise<AttachmentFile>;
  resolvePath(storageKey: string): string;
  readBytes(path: string): Promise<Uint8Array>;
};

export function createBusinessOrderAttachmentFileApiHandler(dependencies: AttachmentFileApiDependencies) {
  return async function businessOrderAttachmentFileApiHandler(_request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const route = await context.params;
    const businessOrderId = positiveRouteId(route.businessOrderId);
    const attachmentId = positiveRouteId(route.attachmentId);
    if (!businessOrderId || !attachmentId) {
      return NextResponse.json({ error: "Business Order 或附件编号无效" }, { status: 400 });
    }
    try {
      const attachment = await dependencies.getAttachmentFile({
        businessOrderId,
        attachmentId,
        viewerAccountId: session.account.id,
      });
      const bytes = await dependencies.readBytes(dependencies.resolvePath(attachment.storageKey));
      const encodedName = encodeURIComponent(attachment.originalName);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": attachment.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return businessApiError(error, "业务附件读取失败");
    }
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderAttachmentFileApiHandler({
      readSession: currentSession,
      getAttachmentFile: (input) => runtime.attachments.getAttachmentFile(input),
      resolvePath: storedBusinessOrderUploadPath,
      readBytes: readFile,
    })(request, context);
  } finally {
    await runtime.close();
  }
}
