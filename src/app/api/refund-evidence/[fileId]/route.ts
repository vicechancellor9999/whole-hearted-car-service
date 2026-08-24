import { readFile } from "node:fs/promises";
import { currentSession } from "@/modules/auth/current-session";
import { createPaymentRuntime } from "@/modules/payment/payment-runtime";
import { PaymentNotFoundError } from "@/modules/payment/payment-service";
import { storedRefundUploadPath } from "@/modules/payment/refund-attachment-storage";
import { requirePermission } from "@/modules/permissions/require-permission";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await currentSession();
  let viewer;
  try {
    viewer = requirePermission(session, "business.read.all");
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const fileId = Number((await params).fileId);
  if (!Number.isSafeInteger(fileId) || fileId < 1) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const runtime = createPaymentRuntime();
  try {
    const file = await runtime.service.getRefundEvidenceFile({
      fileId,
      viewerAccountId: viewer.id,
    });
    const bytes = await readFile(storedRefundUploadPath(file.storageKey));
    const encodedName = encodeURIComponent(file.originalName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mediaType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (
      error instanceof PaymentNotFoundError ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
    ) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  } finally {
    await runtime.close();
  }
}
