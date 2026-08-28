import { NextResponse } from "next/server";
import {
  apiActionContext,
  businessApiError,
  positiveRouteId,
} from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import {
  BUSINESS_ORDER_ATTACHMENT_CATEGORIES,
  type BusinessOrderAttachmentCategory,
  type BusinessOrderAttachmentRecord,
} from "@formal/modules/business-order/business-order-attachment-service";
import {
  isBusinessOrderUploadFile,
  removeStoredBusinessOrderUpload,
  storeBusinessOrderUpload,
  type StoredBusinessOrderUpload,
} from "@formal/modules/business-order/business-order-attachment-storage";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type RouteContext = { params: Promise<{ businessOrderId: string }> };
type AttachmentSession = { account: { id: number } };

type AttachmentApiDependencies = {
  readSession(): Promise<AttachmentSession | null>;
  listAttachments(input: { businessOrderId: number; viewerAccountId: number }): Promise<{ items: BusinessOrderAttachmentRecord[] } | unknown>;
  registerAttachment(input: {
    businessOrderId: number;
    category: BusinessOrderAttachmentCategory;
    caption: string | null;
    stored: StoredBusinessOrderUpload;
    context: BusinessOrderActionContext;
  }): Promise<unknown>;
  storeUpload(file: File): Promise<StoredBusinessOrderUpload>;
  removeUpload(storageKey: string): Promise<void>;
};

export function createBusinessOrderAttachmentsApiHandler(dependencies: AttachmentApiDependencies) {
  return async function businessOrderAttachmentsApiHandler(request: Request, context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) {
      return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    }
    if (request.method === "GET") {
      try {
        return NextResponse.json(await dependencies.listAttachments({
          businessOrderId,
          viewerAccountId: session.account.id,
        }));
      } catch (error) {
        return businessApiError(error, "业务附件读取失败");
      }
    }
    let stored: StoredBusinessOrderUpload | null = null;
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      const category = String(formData.get("category") ?? "");
      const captionValue = String(formData.get("caption") ?? "").trim();
      if (!isBusinessOrderUploadFile(file)) throw new Error("请选择业务附件");
      if (!BUSINESS_ORDER_ATTACHMENT_CATEGORIES.includes(category as BusinessOrderAttachmentCategory)) {
        throw new Error("业务附件分类无效");
      }
      stored = await dependencies.storeUpload(file);
      const attachment = await dependencies.registerAttachment({
        businessOrderId,
        category: category as BusinessOrderAttachmentCategory,
        caption: captionValue || null,
        stored,
        context: apiActionContext(request, session.account.id),
      });
      stored = null;
      return NextResponse.json(attachment, { status: 201 });
    } catch (error) {
      if (stored) await dependencies.removeUpload(stored.storageKey).catch(() => undefined);
      return businessApiError(error, "业务附件上传失败");
    }
  };
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderAttachmentsApiHandler({
      readSession: currentSession,
      listAttachments: (input) => runtime.attachments.listAttachments(input),
      registerAttachment: (input) => runtime.attachments.registerAttachment(input),
      storeUpload: storeBusinessOrderUpload,
      removeUpload: removeStoredBusinessOrderUpload,
    })(request, context);
  } finally {
    await runtime.close();
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}
